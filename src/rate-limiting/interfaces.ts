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
  isWhitelisted?: boolean;
  isBlacklisted?: boolean;
  reason?: string;
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
  allowed?: number;
  denied?: number;
}

/**
 * Storage backend in use.
 */
export type RateLimitStorage = "redis" | "memory";

/**
 * Whitelist item type and definition.
 */
export type ListEntryType = "ip" | "user" | "key" | "path";

export interface WhitelistEntry {
  id: string;
  type: ListEntryType;
  value: string;
  reason?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface BlacklistEntry {
  id: string;
  type: "ip" | "user" | "key";
  value: string;
  reason?: string;
  createdAt: number;
  expiresAt?: number;
}

/**
 * Recorded violation event when a rate limit or blacklist is hit.
 */
export interface RateLimitViolation {
  id: string;
  timestamp: number;
  ip: string;
  tracker: string;
  userId?: string;
  route: string;
  method: string;
  tier: string;
  strategy: RateLimitStrategy;
  limit: number;
  reason: "rate_limit_exceeded" | "blacklisted";
}

/**
 * Aggregated rate-limiting analytics.
 */
export interface RateLimitAnalytics {
  timestamp: string;
  totalViolations: number;
  uniqueViolators: number;
  topViolators: Array<{ tracker: string; count: number }>;
  topRoutes: Array<{ route: string; count: number }>;
  violationsByTier: Record<string, number>;
  violationsByStrategy: Record<string, number>;
  timeSeries: Array<{ time: string; count: number }>;
}

/**
 * Route / endpoint custom rate-limit configuration rule.
 */
export interface EndpointRateLimitRule {
  pathPattern: string; // e.g. "/auth/*", "/api/v1/health", or regex string
  method?: string; // e.g. "POST", "*"
  limit?: number;
  windowMs?: number;
  burst?: number;
  strategy?: RateLimitStrategy;
}
