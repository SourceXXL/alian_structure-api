import { DynamicModule, Global, Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RateLimiterService, RateLimitConfig } from "./rate-limiter.service";
import { DistributedRateLimitGuard } from "./rate-limiting.guard";
import { RateLimitingController } from "./rate-limiting.controller";
import { RATE_LIMIT_CONFIG } from "./rate-limiting.constants";
import { RateLimitStrategy } from "./interfaces";

@Global()
@Module({})
export class RateLimitingModule implements OnModuleInit {
  static forRoot(): DynamicModule {
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
              configService.get<string>("RATE_LIMIT_REDIS_KEY_PREFIX") ??
              "alian:rl:",
            defaultStrategy: (configService.get<string>(
              "RATE_LIMIT_DEFAULT_STRATEGY",
            ) ?? "token-bucket") as RateLimitStrategy,
            enableFallback:
              configService.get<string>("RATE_LIMIT_FALLBACK_TO_MEMORY") !==
              "false",
          }),
        },
        RateLimiterService,
        DistributedRateLimitGuard,
      ],
      exports: [RateLimiterService, DistributedRateLimitGuard],
    };
  }

  constructor(private readonly rateLimiter: RateLimiterService) {}

  onModuleInit(): void {
    this.rateLimiter.getStorageHealth().catch(() => {
      // Storage check is fire-and-forget during startup
    });
  }
}
