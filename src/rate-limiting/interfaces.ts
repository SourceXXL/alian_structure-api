/**
 * Strategies supported by the distributed rate limiter.
 */
export enum RateLimitStrategy {
  TokenBucket = "token-bucket",
  SlidingWindow = "sliding-window",
}

/**
 * Resolved rate-limit policy for a single request.
 */
export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
  burst: number;
  strategy: RateLimitStrategy;
}

/**
 * Decision returned by the rate limiter after consuming a token.
 */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

/**
 * Resolved state for a single rate-limit check.
 */
export interface RateLimitState {
  key: string;
  policy: RateLimitPolicy;
  decision: RateLimitDecision;
  tracker: string;
  scope: string;
  tier: string;
}

/**
 * Aggregated stats for a single rate-limit key.
 */
export interface RateLimitEntry {
  key: string;
  tracker: string;
  scope: string;
  tier: string;
  strategy: RateLimitStrategy;
  limit: number;
  windowMs: number;
  remaining: number;
  resetAt: number;
}

/**
 * Storage backend in use.
 */
export type RateLimitStorage = "redis" | "memory";
