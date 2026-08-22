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
} from "../common/decorators/rate-limit.decorator";
import {
  RateLimitTier,
  getRateLimitPolicyFromEnv,
  normalizeRateLimitTier,
  resolveRateLimitTierFromRole,
} from "../config/quota.config";
import { RateLimitStrategy } from "./interfaces";
import { RateLimiterService } from "./rate-limiter.service";
import {
  rateLimitAllowedTotal,
  rateLimitDeniedTotal,
} from "./rate-limiting.metrics";

interface ResolvedPolicy {
  tier: RateLimitTier;
  label: string;
  limit: number;
  windowMs: number;
  burst: number;
  strategy: RateLimitStrategy;
}

@Injectable()
export class DistributedRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(DistributedRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
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
    const key = this.buildRateLimitKey(tracker, scope, policy.tier);

    const decision = await this.rateLimiter.consume(
      key,
      {
        limit: policy.limit,
        windowMs: policy.windowMs,
        burst: policy.burst,
        strategy: policy.strategy,
      },
      tracker,
      scope,
      policy.tier,
    );

    this.applyHeaders(response, policy, decision);
    this.recordMetrics(tier, scope, policy.strategy, decision);

    if (!decision.allowed) {
      const retryAfter = decision.retryAfterMs
        ? Math.ceil(decision.retryAfterMs / 1000)
        : Math.ceil((decision.resetAt - Date.now()) / 1000);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Rate limit exceeded",
          limit: policy.limit,
          remaining: 0,
          resetAt: new Date(decision.resetAt).toISOString(),
          retryAfter: retryAfter,
          tier: policy.tier,
          strategy: policy.strategy,
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
        limit: envPolicy.limit,
        windowMs: envPolicy.windowMs,
        burst: envPolicy.burst,
        strategy: this.resolveStrategy(options?.strategy),
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
      strategy: this.resolveStrategy(options.strategy),
    };
  }

  private resolveStrategy(strategy?: RateLimitStrategy): RateLimitStrategy {
    if (strategy) return strategy;

    const envStrategy = String(
      process.env.RATE_LIMIT_DEFAULT_STRATEGY ?? "token-bucket",
    ).toLowerCase();

    if (envStrategy === "sliding-window") {
      return RateLimitStrategy.SlidingWindow;
    }

    return RateLimitStrategy.TokenBucket;
  }

  private resolveRequestTier(request: {
    authType?: string;
    user?: {
      id?: string | number;
      role?: string;
      tier?: string;
      type?: string;
    };
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
    request: {
      route?: { path?: string };
      originalUrl?: string;
      url?: string;
    },
    options: RateLimitOptions | undefined,
  ): string {
    if (options?.key) {
      return options.key;
    }

    if (!options) {
      return "global";
    }

    return request.route?.path || request.originalUrl || request.url || "route";
  }

  private buildRateLimitKey(
    tracker: string,
    scope: string,
    tier: string,
  ): string {
    return `${tracker}:${scope}:${tier}`;
  }

  private applyHeaders(
    response: any,
    policy: ResolvedPolicy,
    decision: {
      allowed: boolean;
      remaining: number;
      resetAt: number;
      retryAfterMs?: number;
    },
  ): void {
    const headers: Array<[string, string | number]> = [
      ["X-RateLimit-Limit", policy.limit],
      ["X-RateLimit-Remaining", decision.remaining],
      ["X-RateLimit-Reset", new Date(decision.resetAt).toISOString()],
      ["X-RateLimit-Tier", policy.tier],
      ["X-RateLimit-Strategy", policy.strategy],
    ];

    if (!decision.allowed && decision.retryAfterMs) {
      const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
      headers.push(["Retry-After", retryAfterSeconds]);
    }

    for (const [name, value] of headers) {
      if (typeof response?.header === "function") {
        response.header(name, value);
      } else if (typeof response?.setHeader === "function") {
        response.setHeader(name, value);
      }
    }
  }

  private recordMetrics(
    tier: RateLimitTier,
    scope: string,
    strategy: RateLimitStrategy,
    decision: { allowed: boolean; remaining: number },
  ): void {
    const label = { tier, scope, strategy, key: scope };

    if (decision.allowed) {
      rateLimitAllowedTotal.inc(label);
    } else {
      rateLimitDeniedTotal.inc(label);
    }
  }
}
