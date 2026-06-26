export interface QuotaConfig {
  name: string;
  limit: number; // Number of tokens in the bucket
  windowMs: number; // Time window for refill
  burst: number; // Maximum burst size (capacity)
}

export type RateLimitTier = "free" | "paid" | "enterprise";

export interface RateLimitTierConfig {
  limit: number;
  windowMs: number;
  burst: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BURST_MULTIPLIER = 1.2;

function readEnvNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeRateLimitTier(value?: string | null): RateLimitTier {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    normalized === "paid" ||
    normalized === "standard" ||
    normalized === "premium"
  ) {
    return "paid";
  }

  if (normalized === "enterprise" || normalized === "internal") {
    return "enterprise";
  }

  return "free";
}

export function getRateLimitPolicyFromEnv(
  tier: RateLimitTier,
  env: Record<string, unknown> = process.env,
): RateLimitTierConfig {
  const defaults: Record<RateLimitTier, number> = {
    free: 100,
    paid: 1000,
    enterprise: 10000,
  };

  const envKeyByTier: Record<RateLimitTier, string> = {
    free: "RATE_LIMIT_FREE_PER_MINUTE",
    paid: "RATE_LIMIT_PAID_PER_MINUTE",
    enterprise: "RATE_LIMIT_ENTERPRISE_PER_MINUTE",
  };

  const limit = readEnvNumber(
    env[envKeyByTier[tier]],
    defaults[tier],
  );
  const windowMs = readEnvNumber(
    env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_WINDOW_MS,
  );
  const burstMultiplier = readEnvNumber(
    env.RATE_LIMIT_BURST_MULTIPLIER,
    DEFAULT_BURST_MULTIPLIER,
  );

  return {
    limit,
    windowMs,
    burst: Math.max(limit, Math.ceil(limit * burstMultiplier)),
  };
}

export function resolveRateLimitTierFromRole(
  role?: string | null,
  authType?: string | null,
  explicitTier?: string | null,
): RateLimitTier {
  if (explicitTier) {
    return normalizeRateLimitTier(explicitTier);
  }

  if (authType === "api-key") {
    return "enterprise";
  }

  const normalizedRole = String(role ?? "")
    .trim()
    .toLowerCase();

  if (normalizedRole === "admin") {
    return "enterprise";
  }

  if (
    normalizedRole === "kyc_operator" ||
    normalizedRole === "operator" ||
    normalizedRole === "service"
  ) {
    return "paid";
  }

  return "free";
}

export const QUOTA_LEVELS: Record<string, QuotaConfig> = {
  free: {
    name: "Free Tier",
    limit: 100,
    windowMs: 60_000, // 100 requests per minute
    burst: 120,
  },
  standard: {
    name: "Standard Tier",
    limit: 1000,
    windowMs: 60_000, // 1000 requests per minute
    burst: 1200,
  },
  premium: {
    name: "Premium Tier",
    limit: 10000,
    windowMs: 60_000, // 10000 requests per minute
    burst: 12000,
  },
  internal: {
    name: "Internal Services",
    limit: 10000,
    windowMs: 60_000,
    burst: 15000,
  },
};

export const DEFAULT_QUOTA = QUOTA_LEVELS.free;
