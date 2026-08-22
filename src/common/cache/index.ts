// Module
export { CacheModule } from "./cache.module";

// Services
export { CacheService } from "./cache.service";
export { CacheStatsService } from "./cache-stats.service";
export { CacheWarmingService } from "./cache-warming.service";
export {
  CacheInvalidationService,
  CacheTag,
  InvalidationStrategyType,
} from "./cache-invalidation.service";
export type {
  InvalidationRule,
} from "./cache-invalidation.service";

// Decorators
export { Cacheable, CacheInvalidate } from "./cacheable.decorator";
export type {
  CacheableOptions,
  CacheInvalidateOptions,
} from "./cacheable.decorator";

// Key generation
export { CacheKeyGenerator } from "./cache-key.generator";

// Configuration
export type { CacheConfig } from "./cache.config";
export { DEFAULT_CACHE_CONFIG } from "./cache.config";

// Constants
export {
  CACHE_REDIS_CLIENT,
  CACHE_VERSION,
  CACHE_KEY_PREFIX,
  DEFAULT_TTL_SECONDS,
} from "./cache.constants";

// Factory
export { createRedisClient } from "./cache-redis.factory";
