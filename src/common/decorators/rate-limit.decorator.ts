import { SetMetadata, applyDecorators } from "@nestjs/common";
import { RateLimitStrategy } from "src/rate-limiting/interfaces";

/**
 * Apply a named throttle configuration to a controller or handler.
 *
 * Usage:
 *   @SensitiveRateLimit('auth')     → 5 req / 60 s
 *   @SensitiveRateLimit('oracle')   → 10 req / 60 s
 *   @SensitiveRateLimit('compute')  → 20 req / 60 s
 */
export type SensitiveTier = "auth" | "oracle" | "compute" | "default";

export const RATE_LIMIT_KEY = Symbol("RATE_LIMIT_OPTIONS");

export interface RateLimitOptions {
  level?: string;
  limit?: number;
  windowMs?: number;
  burst?: number;
  /** Rate-limiting strategy: "token-bucket" (default) or "sliding-window". */
  strategy?: RateLimitStrategy;
  /**
   * Custom key prefix for per-key limiting. When omitted, the key is derived
   * automatically from the request tracker + scope + tier.
   */
  key?: string;
}

const TIER_CONFIG: Record<SensitiveTier, { limit: number; ttl: number }> = {
  auth: { limit: 5, ttl: 60_000 }, // 5 req/min – login, wallet-auth, recovery
  oracle: { limit: 10, ttl: 60_000 }, // 10 req/min – signed-payload submission
  compute: { limit: 20, ttl: 60_000 }, // 20 req/min – compute job queueing
  default: { limit: 60, ttl: 60_000 }, // 60 req/min – general endpoints
};

export function SensitiveRateLimit(tier: SensitiveTier = "default") {
  const { limit, ttl } = TIER_CONFIG[tier];
  return applyDecorators(
    RateLimit({
      level: tier,
      limit,
      windowMs: ttl,
      burst: limit,
      strategy: RateLimitStrategy.TokenBucket,
    }),
  );
}

/**
 * Apply custom rate limiting configuration to a controller or handler.
 *
 * Usage:
 *   @RateLimit({ level: 'free', limit: 10, windowMs: 60000 })
 *   @RateLimit({ level: 'premium', burst: 100 })
 */
export function RateLimit(options: RateLimitOptions) {
  return applyDecorators(SetMetadata(RATE_LIMIT_KEY, options));
}
