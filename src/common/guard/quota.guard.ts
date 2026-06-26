import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from "../decorators/rate-limit.decorator";
import {
  RateLimitTier,
  getRateLimitPolicyFromEnv,
  normalizeRateLimitTier,
  resolveRateLimitTierFromRole,
} from "src/config/quota.config";

interface RateWindowState {
  count: number;
  resetAt: number;
}

interface ResolvedPolicy {
  tier: RateLimitTier;
  label: string;
  limit: number;
  windowMs: number;
  burst: number;
}

@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name);
  private readonly windows = new Map<string, RateWindowState>();
  private lastCleanupAt = Date.now();

  constructor(
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const tier = this.resolveRequestTier(request);
    const policy = this.resolvePolicy(options, tier);
    const tracker = this.getTrackerKey(request);
    const scope = this.getScope(request, options);
    const key = `${tracker}:${scope}:${policy.tier}`;

    const decision = this.consume(key, policy.limit, policy.windowMs);
    this.applyHeaders(
      response,
      policy,
      decision.remaining,
      decision.resetAt,
    );

    if (!decision.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Rate limit exceeded",
          limit: policy.limit,
          remaining: 0,
          resetAt: new Date(decision.resetAt).toISOString(),
          tier: policy.tier,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (decision.remaining <= Math.max(1, Math.ceil(policy.limit * 0.1))) {
      this.logger.warn(
        `Approaching rate limit for ${tracker} (${policy.label}): ` +
          `${policy.limit - decision.remaining}/${policy.limit}`,
      );
    }

    return true;
  }

  private resolvePolicy(
    options: RateLimitOptions | undefined,
    tier: RateLimitTier,
  ): ResolvedPolicy {
    const envPolicy = getRateLimitPolicyFromEnv(
      tier,
      process.env as Record<string, unknown>,
    );

    if (!options) {
      return {
        tier,
        label: tier,
        ...envPolicy,
      };
    }

    const configuredTier = options.level
      ? normalizeRateLimitTier(options.level)
      : tier;
    const levelPolicy = getRateLimitPolicyFromEnv(
      configuredTier,
      process.env as Record<string, unknown>,
    );

    return {
      tier: configuredTier,
      label: options.level || configuredTier,
      limit: options.limit ?? levelPolicy.limit,
      windowMs: options.windowMs ?? levelPolicy.windowMs,
      burst: options.burst ?? levelPolicy.burst,
    };
  }

  private resolveRequestTier(request: {
    authType?: string;
    user?: { id?: string | number; role?: string; tier?: string; type?: string };
  }): RateLimitTier {
    const explicitTier = request.user?.tier;
    const authType = request.authType ?? request.user?.type;

    if (authType === "api-key") {
      return normalizeRateLimitTier(explicitTier ?? "enterprise");
    }

    return resolveRateLimitTierFromRole(
      request.user?.role,
      authType,
      explicitTier,
    );
  }

  private getTrackerKey(request: {
    ip?: string;
    headers?: Record<string, unknown>;
    user?: { id?: string | number; sub?: string | number; address?: string };
  }): string {
    const userId = request.user?.id ?? request.user?.sub;
    if (userId !== undefined && userId !== null) {
      return `user:${String(userId)}`;
    }

    if (request.user?.address) {
      return `wallet:${request.user.address.toLowerCase()}`;
    }

    const xff = request.headers?.["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return `ip:${xff.split(",")[0].trim()}`;
    }

    return `ip:${request.ip ?? "unknown"}`;
  }

  private getScope(
    request: { route?: { path?: string }; originalUrl?: string; url?: string },
    options: RateLimitOptions | undefined,
  ): string {
    if (!options) {
      return "global";
    }

    return request.route?.path || request.originalUrl || request.url || "route";
  }

  private consume(
    key: string,
    limit: number,
    windowMs: number,
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let state = this.windows.get(key);

    if (!state || state.resetAt <= now) {
      state = {
        count: 0,
        resetAt: now + windowMs,
      };
      this.windows.set(key, state);
    }

    state.count += 1;
    const remaining = Math.max(0, limit - state.count);
    const allowed = state.count <= limit;

    this.windows.set(key, state);
    this.cleanupExpired(now);

    return {
      allowed,
      remaining,
      resetAt: state.resetAt,
    };
  }

  private applyHeaders(
    response: any,
    policy: ResolvedPolicy,
    remaining: number,
    resetAt: number,
  ): void {
    const headers: Array<[string, string | number]> = [
      ["X-RateLimit-Limit", policy.limit],
      ["X-RateLimit-Remaining", remaining],
      ["X-RateLimit-Reset", new Date(resetAt).toISOString()],
      ["X-RateLimit-Tier", policy.tier],
    ];

    for (const [name, value] of headers) {
      if (typeof response?.header === "function") {
        response.header(name, value);
      } else if (typeof response?.setHeader === "function") {
        response.setHeader(name, value);
      }
    }
  }

  private cleanupExpired(now: number): void {
    if (this.windows.size === 0) {
      return;
    }

    if (now - this.lastCleanupAt < 30_000 && this.windows.size < 1000) {
      return;
    }

    for (const [key, state] of this.windows.entries()) {
      if (state.resetAt <= now) {
        this.windows.delete(key);
      }
    }

    this.lastCleanupAt = now;
  }
}
