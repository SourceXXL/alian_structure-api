import { logger } from "../../config/logger";

/**
 * Options for the {@link Cacheable} decorator.
 */
export interface CacheableOptions {
  /**
   * Namespace (logical grouping) for the cache key.
   * If omitted, defaults to `ClassName.methodName`.
   */
  namespace?: string;

  /** TTL in seconds. If omitted, the global default is used. */
  ttlSeconds?: number;

  /**
   * An optional function that derives the cache key from the method arguments.
   * When provided, this is used *instead of* hashing all arguments, giving the
   * caller full control over the key shape.
   */
  keyBuilder?: (...args: unknown[]) => string;
}

/**
 * Method decorator that transparently caches the return value of the wrapped
 * method.
 *
 * Works for both synchronous and asynchronous methods. The cache key is built
 * from the method's arguments via the {@link CacheKeyGenerator} (or a custom
 * {@link CacheableOptions.keyBuilder}).
 *
 * If the method throws, nothing is cached and the error is re-thrown.
 *
 * Expects the host class to have injectable properties:
 *   - `cacheService: CacheService`
 *   - `cacheStatsService: CacheStatsService` (optional)
 *
 * @example
 *   class UserService {
 *     @Cacheable({ namespace: 'user', ttlSeconds: 600 })
 *     async getUser(id: string) {
 *       return this.repo.findOne(id);
 *     }
 *   }
 */
export function Cacheable(options: CacheableOptions = {}): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const original = descriptor.value;
    if (typeof original !== "function") return descriptor;

    const cacheNamespace =
      options.namespace ??
      `${target?.constructor?.name ?? "Anonymous"}.${String(propertyKey)}`;

    descriptor.value = function cached(...args: unknown[]) {
      // Lazy-resolve the CacheService from the instance (NestJS injectable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cacheService = (this as any).cacheService;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsService = (this as any).cacheStatsService;

      if (!cacheService) {
        logger.debug(
          { namespace: cacheNamespace },
          "CacheService not available — skipping cache",
        );
        return original.apply(this, args);
      }

      const keyArgs = options.keyBuilder
        ? [options.keyBuilder(...args)]
        : args;
      const key = cacheService.keys.generate(cacheNamespace, ...keyArgs);

      const executeAndCache = async (): Promise<unknown> => {
        const result = await original.apply(this, args);
        await cacheService.set(
          cacheNamespace,
          result,
          keyArgs,
          options.ttlSeconds,
        );
        statsService?.recordSet(cacheNamespace);
        return result;
      };

      return (async () => {
        // Attempt cache read FIRST — before starting any execution
        try {
          const cached = await cacheService.get(
            cacheNamespace,
            ...keyArgs,
          );
          if (cached !== undefined && cached !== null) {
            statsService?.recordHit(cacheNamespace);
            return cached;
          }
          statsService?.recordMiss(cacheNamespace);
        } catch (err) {
          logger.debug(
            { namespace: cacheNamespace, error: err.message },
            "Cache read failed, executing method",
          );
          statsService?.recordError("read");
        }

        // Cache miss — execute with stampede prevention
        try {
          return await (cacheService.config?.enableStampedePrevention !== false
            ? cacheService.singleflight(key, executeAndCache)
            : executeAndCache());
        } catch (err) {
          statsService?.recordError("exec");
          throw err;
        }
      })();
    };

    // Preserve the original function name for stack traces
    Object.defineProperty(descriptor.value, "name", {
      value:
        typeof original.name === "string" ? original.name : "cached",
      configurable: true,
    });

    return descriptor;
  };
}

/**
 * Options for the {@link CacheInvalidate} decorator.
 */
export interface CacheInvalidateOptions {
  /**
   * Namespaces to invalidate after the method executes successfully.
   */
  namespaces: string[];

  /**
   * When true, invalidate only when the method does *not* throw.
   * Default: true.
   */
  onlyOnSuccess?: boolean;
}

/**
 * Method decorator that invalidates specified cache namespaces after the
 * wrapped method completes. Useful for invalidating cache on data mutations.
 *
 * @example
 *   class UserService {
 *     @CacheInvalidate({ namespaces: ['user', 'user-profile'] })
 *     async updateUser(id: string, data: UpdateDto) {
 *       return this.repo.update(id, data);
 *     }
 *   }
 */
export function CacheInvalidate(
  options: CacheInvalidateOptions,
): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const original = descriptor.value;
    if (typeof original !== "function") return descriptor;

    const onlyOnSuccess = options.onlyOnSuccess !== false;

    descriptor.value = function invalidated(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cacheService = (this as any).cacheService;

      const result = original.apply(this, args);

      const invalidate = async () => {
        if (!cacheService) return;
        for (const ns of options.namespaces) {
          try {
            await cacheService.invalidatePrefix(ns);
          } catch (err) {
            logger.warn(
              { namespace: ns, error: err.message },
              "Cache invalidation failed",
            );
          }
        }
      };

      // Handle async methods
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<unknown>).then(
          (value) => {
            if (onlyOnSuccess) {
              invalidate();
            }
            return value;
          },
          (err) => {
            if (!onlyOnSuccess) {
              invalidate();
            }
            throw err;
          },
        );
      }

      // Handle sync methods
      if (onlyOnSuccess) {
        invalidate();
      }
      return result;
    };

    Object.defineProperty(descriptor.value, "name", {
      value:
        typeof original.name === "string"
          ? original.name
          : "invalidated",
      configurable: true,
    });

    return descriptor;
  };
}
