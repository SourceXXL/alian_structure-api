/**
 * Configuration interface for the cache module.
 *
 * All fields are optional — sensible defaults are applied in
 * {@link CacheModule}.
 */
export interface CacheConfig {
  /** Prefix prepended to every cache key. Default: "alian:cache:". */
  prefix?: string;

  /** Default TTL in seconds for cache entries. Default: 300. */
  defaultTtlSeconds?: number;

  /** Maximum entries kept in the in-memory fallback cache. Default: 1000. */
  memoryMaxEntries?: number;

  /** Enable or disable hit/miss statistics tracking. Default: true. */
  enableStats?: boolean;

  /**
   * Enable stampede prevention (singleflight).
   * When true, concurrent requests for the same cache key are collapsed
   * into a single upstream call. Default: true.
   */
  enableStampedePrevention?: boolean;

  /** In-memory cache instance for fallback when Redis is unavailable. */
  memoryCache?: Map<string, { value: string; expiresAt: number }>;
}

/** Default configuration values. */
export const DEFAULT_CACHE_CONFIG: Required<
  Omit<CacheConfig, "memoryCache">
> & { memoryCache?: Map<string, { value: string; expiresAt: number }> } = {
  prefix: "alian:cache:",
  defaultTtlSeconds: 300,
  memoryMaxEntries: 1000,
  enableStats: true,
  enableStampedePrevention: true,
};
