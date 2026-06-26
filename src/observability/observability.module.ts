import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ProfilingService } from "./profiling.service";
import { ProfilingController } from "./profiling.controller";
import { RequestTimingMiddleware } from "./request-timing.middleware";
import { DatabaseTimingInterceptor } from "./database-timing.interceptor";
import { PerformanceBaselineService } from "./performance-baseline.service";
import { ObservabilityController } from "./observability.controller";
import { TracingInterceptor } from "./tracing.interceptor";

@Module({
  providers: [
    ProfilingService,
    RequestTimingMiddleware,
    PerformanceBaselineService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DatabaseTimingInterceptor,
    },
  ],
  controllers: [ProfilingController, ObservabilityController],
  exports: [
    ProfilingService,
    RequestTimingMiddleware,
    PerformanceBaselineService,
  ],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply request timing middleware to all routes
    consumer.apply(RequestTimingMiddleware).forRoutes("*");
  }
}
