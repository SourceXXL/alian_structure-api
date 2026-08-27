import { DynamicModule, Global, Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RateLimiterService, RateLimitConfig } from "./rate-limiter.service";
import { DistributedRateLimitGuard } from "./rate-limiting.guard";
import { RateLimitMiddleware } from "./rate-limit.middleware";
import { RateLimitingController } from "./rate-limiting.controller";
import { RATE_LIMIT_CONFIG } from "./rate-limiting.constants";
import { RateLimitStrategy } from "./interfaces";

@Global()
@Module({})
export class RateLimitingModule implements OnModuleInit {
  static forRoot(options?: RateLimitConfig): DynamicModule {
    return {
      module: RateLimitingModule,
      imports: [ConfigModule],
      controllers: [RateLimitingController],
      providers: [
        {
          provide: RATE_LIMIT_CONFIG,
          inject: [ConfigService],
          useFactory: (configService: ConfigService): RateLimitConfig => ({
            keyPrefix:
              options?.keyPrefix ??
              configService.get<string>("RATE_LIMIT_REDIS_KEY_PREFIX") ??
              "alian:rl:",
            defaultStrategy: (options?.defaultStrategy ??
              configService.get<string>("RATE_LIMIT_DEFAULT_STRATEGY") ??
              "token-bucket") as RateLimitStrategy,
            enableFallback:
              options?.enableFallback ??
              configService.get<string>("RATE_LIMIT_FALLBACK_TO_MEMORY") !==
                "false",
            endpointRules: options?.endpointRules,
          }),
        },
        RateLimiterService,
        DistributedRateLimitGuard,
        RateLimitMiddleware,
      ],
      exports: [
        RateLimiterService,
        DistributedRateLimitGuard,
        RateLimitMiddleware,
      ],
    };
  }

  constructor(private readonly rateLimiter: RateLimiterService) {}

  onModuleInit(): void {
    this.rateLimiter.getStorageHealth().catch(() => {
      // Storage check is fire-and-forget during startup
    });
  }
}
