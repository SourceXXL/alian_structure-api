export const RATE_LIMITING_MODULE_OPTIONS = Symbol(
  "RATE_LIMITING_MODULE_OPTIONS",
);

export const RATE_LIMIT_CONFIG = "RATE_LIMIT_CONFIG";

export const REDIS_RATE_LIMIT_CLIENT = Symbol("REDIS_RATE_LIMIT_CLIENT");

export const RATE_LIMIT_KEY_PREFIX = "alian:ratelimit:";

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export const DEFAULT_RATE_LIMIT_STRATEGY = "token-bucket";

export const REDIS_RATE_LIMIT_TTL_SECONDS = 120;
