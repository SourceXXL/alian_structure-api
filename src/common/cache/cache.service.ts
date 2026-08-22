import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { logger } from "../../config/logger";
import {
  CacheConfig,
  DEFAULT_CACHE_CONFIG,
} from "./cache.config";
import { CacheKeyGenerator } from "./cache-key.generator";

interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Primary cache service with Redis as the backing store and an in-memory LRU
 * cache for graceful fallback.
 *
 * Features:
 * - Automatic Redis ↔ in-memory fallback
 * - Stampede prevention via singleflight promises
 * - Pattern-based and prefix-based invalidation
 * - Deterministic key generation with versioning
 * - Configurable TTL per entry or globally
 */
@Injectable()
export class CacheService {
  private readonly redis: Redis | null;
  private readonly memoryCache: Map<string, MemoryCacheEntry>;
  private readonly keyGenerator: CacheKeyGenerator;
  readonly config: Required<
    Omit<CacheConfig, "memoryCache">
  > & { memoryCache?: Map<string, MemoryCacheEntry> };

  /** In-flight singleflight map for stampede prevention. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Optional() redis: Redis | null,
    configService: ConfigService,
    cacheConfig?: Partial<CacheConfig>,
  ) {
    this.redis = redis;
    this.config = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };
    this.memoryCache =
      this.config.memoryCache ??
      new Map<string, MemoryCacheEntry>();

    const version = cacheServiceGetVersion(configService);
    this.keyGenerator = new CacheKeyGenerator(
      this.config.prefix,
      version,
    );
  }

  // -------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------

  /**
   * Retrieve a cached value by namespace and arguments.
   *
   * @param namespace  Logical grouping (e.g. "user", "portfolio")
   * @param args       Argument values used to build the cache key
   * @returns The deserialised cached value, or null on miss
   */
  async get<T = unknown>(
    namespace: string,
    ...args: unknown[]
  ): Promise<T | null> {
    const key = this.keyGenerator.generate(namespace, ...args);
    const raw = await this.getRaw(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  /**
   * Retrieve multiple cached values in a single round-trip.
   */
  async getMany<T = unknown>(
    namespace: string,
    keys: unknown[][],
  ): Promise<(T | null)[]> {
    if (this.redis) {
      const redisKeys = keys.map((args) =>
        this.keyGenerator.generate(namespace, ...args),
      );
      try {
        const values = await this.redis.mget(...redisKeys);
        return values.map((v) => {
          if (v === null) return null;
          try {
            return JSON.parse(v) as T;
          } catch {
            return v as unknown as T;
          }
        });
      } catch (err) {
        logger.warn({ error: err.message }, "Redis mget failed, falling back");
      }
    }
    // Fallback: individual in-memory reads
    return Promise.all(
      keys.map((args) => this.get<T>(namespace, ...args)),
    );
  }

  /**
   * Store a value with an optional TTL override.
   *
   * The cache key is derived solely from `namespace` + `args` — the TTL is
   * metadata, not part of the key.
   */
  async set(
    namespace: string,
    value: unknown,
    args: unknown[],
    ttlSeconds?: number,
  ): Promise<void> {
    const key = this.keyGenerator.generate(namespace, ...args);
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    const serialised = JSON.stringify(value);
    const expiresAt = Date.now() + ttl * 1000;

    // Write to in-memory immediately
    this.setMemory(key, serialised, expiresAt);

    // Write to Redis (fire-and-forget; memory is the source of truth for fallback)
    if (this.redis) {
      try {
        await this.redis.setex(key, ttl, serialised);
      } catch (err) {
        logger.warn(
          { error: err.message, key },
          "Redis setex failed, value cached in memory only",
        );
      }
    }
  }

  /**
   * Delete a single cache entry by namespace and arguments.
   */
  async del(namespace: string, ...args: unknown[]): Promise<void> {
    const key = this.keyGenerator.generate(namespace, ...args);
    this.memoryCache.delete(key);
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (err) {
        logger.warn({ error: err.message, key }, "Redis del failed");
      }
    }
  }

  /**
   * Check whether a key exists (does not refresh TTL).
   */
  async has(namespace: string, ...args: unknown[]): Promise<boolean> {
    const key = this.keyGenerator.generate(namespace, ...args);
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      if (entry.expiresAt > Date.now()) return true;
      this.memoryCache.delete(key);
    }
    if (this.redis) {
      try {
        return (await this.redis.exists(key)) === 1;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Retrieve the remaining TTL (seconds) for a key, or -1 if not found.
   */
  async ttl(namespace: string, ...args: unknown[]): Promise<number> {
    const key = this.keyGenerator.generate(namespace, ...args);
    if (this.redis) {
      try {
        return await this.redis.ttl(key);
      } catch {
        // fall through
      }
    }
    const entry = this.memoryCache.get(key);
    if (!entry) return -1;
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -1;
  }

  // -------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------

  /**
   * Delete all cache entries whose key matches a Redis SCAN pattern.
   *
   * For the in-memory cache this performs a linear scan, which is acceptable
   * for small caches. For large deployments prefer prefix-based invalidation.
   */
  async delPattern(pattern: string): Promise<number> {
    let deleted = 0;

    // In-memory scan
    const regex = this.globToRegex(pattern);
    const keysToDelete: string[] = [];
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.memoryCache.delete(key);
      deleted++;
    }

    // Redis SCAN
    if (this.redis) {
      try {
        let cursor = "0";
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100,
          );
          cursor = nextCursor;
          if (keys.length > 0) {
            deleted += await this.redis.del(...keys);
          }
        } while (cursor !== "0");
      } catch (err) {
        logger.warn(
          { error: err.message, pattern },
          "Redis delPattern failed",
        );
      }
    }

    return deleted;
  }

  /**
   * Convenience: invalidate every key under a given namespace.
   */
  async invalidatePrefix(namespace: string): Promise<number> {
    const pattern = this.keyGenerator.namespacePrefix(namespace);
    return this.delPattern(pattern);
  }

  /**
   * Wipe the entire cache (both memory and Redis).
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    if (this.redis) {
      try {
        await this.redis.flushdb();
      } catch (err) {
        logger.warn({ error: err.message }, "Redis flushdb failed");
      }
    }
  }

  // -------------------------------------------------------------------
  // Stampede prevention
  // -------------------------------------------------------------------

  /**
   * Execute a function with singleflight stampede prevention.
   *
   * If multiple callers invoke this with the same key simultaneously, only
   * the first caller executes `fn`; the rest receive the same result.
   */
  async singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.inflight.has(key)) {
      return this.inflight.get(key) as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  // -------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------

  /** Direct access to the underlying Redis client (null if unavailable). */
  get client(): Redis | null {
    return this.redis;
  }

  /** Key generator — used by the @Cacheable decorator. */
  get keys(): CacheKeyGenerator {
    return this.keyGenerator;
  }

  /** Whether Redis is currently connected and usable. */
  async isRedisConnected(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const pong = await this.redis.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  /** Number of entries in the in-memory cache. */
  get memorySize(): number {
    return this.memoryCache.size;
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private async getRaw(key: string): Promise<string | null> {
    // Try Redis first
    if (this.redis) {
      try {
        const value = await this.redis.get(key);
        if (value !== null) return value;
      } catch (err) {
        logger.debug(
          { error: err.message, key },
          "Redis get failed, falling back to memory",
        );
      }
    }

    // Fallback: in-memory
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setMemory(
    key: string,
    value: string,
    expiresAt: number,
  ): void {
    // Evict oldest entries when at capacity (simple FIFO approximation)
    if (
      this.memoryCache.size >= this.config.memoryMaxEntries &&
      !this.memoryCache.has(key)
    ) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        this.memoryCache.delete(firstKey);
      }
    }
    this.memoryCache.set(key, { value, expiresAt });
  }

  /**
   * Convert a simple glob pattern (supporting `*` and `?`) to a RegExp.
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cacheServiceGetVersion(configService: ConfigService): string {
  return configService.get<string>("CACHE_VERSION") ?? "v1";
}
