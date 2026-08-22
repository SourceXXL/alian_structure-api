import { Inject, Module, Global, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { CacheService } from "./cache.service";
import { CacheStatsService } from "./cache-stats.service";
import { CacheWarmingService } from "./cache-warming.service";
import { CacheInvalidationService } from "./cache-invalidation.service";
import { CacheController } from "./cache.controller";
import { CACHE_REDIS_CLIENT } from "./cache.constants";
import { createRedisClient } from "./cache-redis.factory";
import { logger } from "../../config/logger";

/**
 * Global caching module.
 *
 * Provides Redis-backed caching with in-memory fallback, automatic
 * memoisation via the {@link Cacheable} decorator, cache warming, and
 * Prometheus-backed stats.
 *
 * @example
 *   // In app.module.ts
 *   import { CacheModule } from './common/cache/cache.module';
 *
 *   @Module({ imports: [CacheModule] })
 *   export class AppModule {}
 *
 *   // In a service
 *   @Injectable()
 *   export class UserService {
 *     constructor(
 *       private readonly cache: CacheService,
 *       private readonly cacheStatsService: CacheStatsService,
 *     ) {}
 *
 *     @Cacheable({ namespace: 'user', ttlSeconds: 600 })
 *     async getUser(id: string) { ... }
 *   }
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [CacheController],
  providers: [
    {
      provide: CACHE_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis | null => {
        const redisUrl = configService.get<string>("REDIS_URL");
        if (!redisUrl) {
          logger.warn(
            "REDIS_URL not set — cache will use in-memory fallback only",
          );
          return null;
        }
        return createRedisClient(redisUrl, "cache");
      },
    },
    {
      provide: CacheService,
      inject: [CACHE_REDIS_CLIENT, ConfigService],
      useFactory: (
        redis: Redis | null,
        configService: ConfigService,
      ): CacheService => {
        return new CacheService(redis, configService);
      },
    },
    CacheStatsService,
    {
      provide: CacheInvalidationService,
      inject: [CacheService],
      useFactory: (cache: CacheService): CacheInvalidationService => {
        return new CacheInvalidationService(cache);
      },
    },
    CacheWarmingService,
  ],
  exports: [
    CacheService,
    CacheStatsService,
    CacheInvalidationService,
    CacheWarmingService,
    CACHE_REDIS_CLIENT,
  ],
})
export class CacheModule implements OnModuleDestroy {
  constructor(
    @Optional() @Inject(CACHE_REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
        logger.info("Cache Redis client disconnected gracefully");
      } catch (err) {
        logger.warn(
          { error: err.message },
          "Cache Redis client disconnect error",
        );
      }
    }
  }
}
