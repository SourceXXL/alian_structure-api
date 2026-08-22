/**
 * Injection tokens and constants for the caching module.
 */

/** Injection token for the ioredis Redis client instance. */
export const CACHE_REDIS_CLIENT = "CACHE_REDIS_CLIENT";

/** Injection token for the cache version string (used in key prefixing). */
export const CACHE_VERSION = "CACHE_VERSION";

/** Default key prefix for all cache entries. */
export const CACHE_KEY_PREFIX = "alian:cache:";

/** Default cache TTL in seconds (5 minutes). */
export const DEFAULT_TTL_SECONDS = 300;

/** Maximum entries in the in-memory fallback LRU cache. */
export const DEFAULT_MEMORY_MAX_ENTRIES = 1000;

/** Key used by Redis SCAN for pattern-based invalidation. */
export const REDIS_SCAN_COUNT = 100;
