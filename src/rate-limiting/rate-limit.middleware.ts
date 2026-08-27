import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestMiddleware,
} from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import {
  getRateLimitPolicyFromEnv,
  normalizeRateLimitTier,
  RateLimitTier,
  resolveRateLimitTierFromRole,
} from "../config/quota.config";
import { RateLimitPolicy, RateLimitStrategy } from "./interfaces";
import { RateLimiterService } from "./rate-limiter.service";
import {
  rateLimitAllowedTotal,
  rateLimitDeniedTotal,
} from "./rate-limiting.metrics";

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(private readonly rateLimiter: RateLimiterService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawIp = this.getClientIp(req);
    const userId = this.getUserId(req);
    const path = req.baseUrl || req.path || req.originalUrl || "/";
    const method = req.method;

    // 1. Check Blacklist
    const isBlacklisted = await this.rateLimiter.isBlacklisted(
      rawIp,
      userId ? String(userId) : undefined,
    );

    if (isBlacklisted) {
      await this.rateLimiter.recordViolation({
        ip: rawIp,
        tracker: userId ? `user:${userId}` : `ip:${rawIp}`,
        userId: userId ? String(userId) : undefined,
        route: path,
        method,
        tier: "blacklisted",
        strategy: RateLimitStrategy.TokenBucket,
        limit: 0,
        reason: "blacklisted",
      });

      res.setHeader("X-RateLimit-Blocked", "blacklisted");
      res.status(HttpStatus.FORBIDDEN).json({
        statusCode: HttpStatus.FORBIDDEN,
        message: "Access forbidden: Client identifier is blacklisted",
        error: "Forbidden",
      });
      return;
    }

    // 2. Check Whitelist
    const isWhitelisted = await this.rateLimiter.isWhitelisted(
      rawIp,
      userId ? String(userId) : undefined,
      undefined,
      path,
    );

    if (isWhitelisted) {
      res.setHeader("X-RateLimit-Whitelisted", "true");
      return next();
    }

    // 3. Resolve Policy (Endpoint Rule or Tier Default)
    const endpointRule = this.rateLimiter.getEndpointRule(path, method);
    const tier = this.resolveRequestTier(req);

    const envPolicy = getRateLimitPolicyFromEnv(
      tier,
      process.env as Record<string, unknown>,
    );

    const policy: RateLimitPolicy = {
      limit: endpointRule?.limit ?? envPolicy.limit,
      windowMs: endpointRule?.windowMs ?? envPolicy.windowMs,
      burst: endpointRule?.burst ?? envPolicy.burst,
      strategy:
        endpointRule?.strategy ??
        this.resolveStrategy(process.env.RATE_LIMIT_DEFAULT_STRATEGY),
    };

    const tracker = userId ? `user:${userId}` : `ip:${rawIp}`;
    const scope = endpointRule ? endpointRule.pathPattern : path;
    const key = `${tracker}:${scope}:${tier}`;

    // 4. Consume Rate Limit
    const decision = await this.rateLimiter.consume(
      key,
      policy,
      tracker,
      scope,
      tier,
    );

    // 5. Apply Headers
    this.applyHeaders(res, policy, decision, tier);
    this.recordMetrics(tier, scope, policy.strategy, decision);

    // 6. Handle Enforcement Decision
    if (!decision.allowed) {
      await this.rateLimiter.recordViolation({
        ip: rawIp,
        tracker,
        userId: userId ? String(userId) : undefined,
        route: path,
        method,
        tier,
        strategy: policy.strategy,
        limit: policy.limit,
        reason: "rate_limit_exceeded",
      });

      const retryAfter = decision.retryAfterMs
        ? Math.ceil(decision.retryAfterMs / 1000)
        : Math.ceil((decision.resetAt - Date.now()) / 1000);

      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: "Rate limit exceeded",
        limit: policy.limit,
        remaining: 0,
        resetAt: new Date(decision.resetAt).toISOString(),
        retryAfter,
        tier,
        strategy: policy.strategy,
      });
      return;
    }

    next();
  }

  private getClientIp(req: Request): string {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0].trim();
    }
    return req.ip || (req.socket as any)?.remoteAddress || "127.0.0.1";
  }

  private getUserId(req: any): string | number | undefined {
    return req.user?.id ?? req.user?.sub ?? req.user?.address;
  }

  private resolveRequestTier(req: any): RateLimitTier {
    const explicitTier = req.user?.tier;
    const authType = req.authType ?? req.user?.type;

    if (authType === "api-key") {
      return normalizeRateLimitTier(explicitTier ?? "enterprise");
    }

    return resolveRateLimitTierFromRole(
      req.user?.role,
      authType,
      explicitTier,
    );
  }

  private resolveStrategy(strategyStr?: string): RateLimitStrategy {
    if (
      strategyStr &&
      strategyStr.toLowerCase() === RateLimitStrategy.SlidingWindow
    ) {
      return RateLimitStrategy.SlidingWindow;
    }
    return RateLimitStrategy.TokenBucket;
  }

  private applyHeaders(
    res: Response,
    policy: RateLimitPolicy,
    decision: {
      allowed: boolean;
      remaining: number;
      resetAt: number;
      retryAfterMs?: number;
    },
    tier: string,
  ): void {
    res.setHeader("X-RateLimit-Limit", policy.limit);
    res.setHeader("X-RateLimit-Remaining", decision.remaining);
    res.setHeader("X-RateLimit-Reset", new Date(decision.resetAt).toISOString());
    res.setHeader("X-RateLimit-Tier", tier);
    res.setHeader("X-RateLimit-Strategy", policy.strategy);

    if (!decision.allowed && decision.retryAfterMs) {
      const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
      res.setHeader("Retry-After", retryAfterSeconds);
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
