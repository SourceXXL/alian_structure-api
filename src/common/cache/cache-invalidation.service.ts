import { logger } from "../../config/logger";
import type { CacheService } from "./cache.service";

/**
 * Strategy for cache invalidation after data mutations.
 */
export enum InvalidationStrategyType {
  /** Invalidate all keys under a namespace prefix. */
  PREFIX = "prefix",

  /** Invalidate keys matching a glob pattern. */
  PATTERN = "pattern",

  /** Invalidate specific keys derived from the method's arguments. */
  KEY = "key",

  /** Tag-based: invalidate all entries that were stored with a given tag. */
  TAG = "tag",
}

/**
 * Configuration for a single invalidation rule.
 */
export interface InvalidationRule {
  /** The strategy to use. */
  type: InvalidationStrategyType;

  /**
   * For `PREFIX`: the namespace to invalidate.
   * For `PATTERN`: a glob pattern string.
   * For `KEY`: a function returning the cache key to delete.
   * For `TAG`: the tag to look up.
   */
  value: string | ((...args: unknown[]) => string);
}

/**
 * Execute invalidation rules after a mutation method completes.
 *
 * Designed to be called imperatively from a service method, or composed into
 * a post-execution decorator.
 *
 * @example
 *   async updatePortfolio(id: string, data: UpdateDto) {
 *     const result = await this.repo.update(id, data);
 *     await this.cacheInvalidation.execute(
 *       [{ type: InvalidationStrategyType.PREFIX, value: 'portfolio' }],
 *       [id, data],
 *     );
 *     return result;
 *   }
 */
export class CacheInvalidationService {
  constructor(private readonly cache: CacheService) {}

  /**
   * Execute the given invalidation rules.
   *
   * @param rules   Array of invalidation rules to apply.
   * @param args    Original method arguments (used by KEY strategy).
   */
  async execute(
    rules: InvalidationRule[],
    args: unknown[] = [],
  ): Promise<void> {
    for (const rule of rules) {
      try {
        switch (rule.type) {
          case InvalidationStrategyType.PREFIX:
            await this.cache.invalidatePrefix(rule.value as string);
            break;

          case InvalidationStrategyType.PATTERN:
            await this.cache.delPattern(rule.value as string);
            break;

          case InvalidationStrategyType.KEY: {
            const keyFn = rule.value as (...a: unknown[]) => string;
            const key = keyFn(...args);
            await this.cache.delPattern(key);
            break;
          }

          case InvalidationStrategyType.TAG:
            await this.cache.delPattern(`*:*:tag:${rule.value}*`);
            break;
        }
      } catch (err) {
        logger.warn(
          { error: err.message, strategy: rule.type },
          "Cache invalidation rule failed",
        );
      }
    }
  }
}

/**
 * A cache tag that can be associated with entries during storage.
 * When combined with `CacheInvalidationService`, entries tagged with a
 * specific tag can be bulk-invalidated.
 */
export class CacheTag {
  private tag: string;

  constructor(name: string) {
    this.tag = name;
  }

  /** Return the tag string used as part of a cache key. */
  toString(): string {
    return `tag:${this.tag}`;
  }
}
