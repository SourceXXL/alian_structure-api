/**
 * LoggerModule — NestJS dynamic module providing centralized structured logging.
 *
 * Registers and exports:
 *   - {@link LoggerService}    — Winston-backed, implements NestJS LoggerService
 *   - {@link HttpLoggingMiddleware} — request/response logging middleware
 *   - {@link PerformanceInterceptor} — slow-operation metric logging
 *
 * ## Basic usage (global, using env defaults)
 * ```ts
 * @Module({ imports: [LoggerModule.forRoot()] })
 * export class AppModule {}
 * ```
 *
 * ## With options
 * ```ts
 * LoggerModule.forRoot({
 *   serviceName: 'my-service',
 *   level: 'debug',
 *   logFileDir: '/var/log/alian',
 * })
 * ```
 *
 * ## Async (ConfigService)
 * ```ts
 * LoggerModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (cfg: ConfigService) => ({
 *     level: cfg.get('LOG_LEVEL'),
 *     logFileDir: cfg.get('LOG_FILE_DIR'),
 *   }),
 * })
 * ```
 */

import {
  Module,
  DynamicModule,
  Global,
  Provider,
  MiddlewareConsumer,
  NestModule,
  ModuleMetadata,
  Type,
  Optional,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerService, LOGGER_OPTIONS } from "./logger.service";
import { HttpLoggingMiddleware } from "./http-logging.middleware";
import {
  PerformanceInterceptor,
  PerformanceInterceptorConfig,
} from "./performance.interceptor";
import { createCloudWatchTransport } from "./cloudwatch.transport";
import { createElkTransport } from "./elk.transport";
import { LoggerModuleOptions } from "./winston.config";

// ---------------------------------------------------------------------------
// Async options types
// ---------------------------------------------------------------------------

export interface LoggerModuleAsyncOptions extends Pick<
  ModuleMetadata,
  "imports"
> {
  useFactory: (
    ...args: unknown[]
  ) => Promise<LoggerModuleOptions> | LoggerModuleOptions;
  inject?: Array<Type<unknown> | string | symbol>;
}

// ---------------------------------------------------------------------------
// Module options extension
// ---------------------------------------------------------------------------

export interface LoggerRootOptions extends LoggerModuleOptions {
  /**
   * When true, registers PerformanceInterceptor globally.
   * Default: true
   */
  enablePerformanceInterceptor?: boolean;

  /**
   * Config for the PerformanceInterceptor.
   * Only relevant when `enablePerformanceInterceptor` is true.
   */
  performanceConfig?: Partial<PerformanceInterceptorConfig>;

  /**
   * When true, attaches CloudWatch transport if env vars are present.
   * Default: true
   */
  enableCloudWatch?: boolean;

  /**
   * When true, attaches ELK transport if ELASTICSEARCH_URL is present.
   * Default: true
   */
  enableElk?: boolean;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

@Global()
@Module({})
export class LoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // HTTP logging is registered globally by forRoot/forRootAsync
    // when the module is imported into AppModule.
    consumer.apply(HttpLoggingMiddleware).forRoutes("*");
  }

  // -------------------------------------------------------------------------
  // Static registration
  // -------------------------------------------------------------------------

  static forRoot(opts: LoggerRootOptions = {}): DynamicModule {
    const loggerOptionsProvider: Provider = {
      provide: LOGGER_OPTIONS,
      useValue: opts,
    };

    const loggerServiceProvider: Provider = {
      provide: LoggerService,
      useFactory: (options: LoggerRootOptions) => {
        const svc = new LoggerService(options);

        // Attach external transports after the logger is created
        if (options.enableCloudWatch !== false) {
          createCloudWatchTransport(svc.winstonLogger);
        }
        if (options.enableElk !== false) {
          createElkTransport(svc.winstonLogger);
        }

        return svc;
      },
      inject: [LOGGER_OPTIONS],
    };

    const middlewareProvider: Provider = {
      provide: HttpLoggingMiddleware,
      useFactory: (svc: LoggerService) => new HttpLoggingMiddleware(svc),
      inject: [LoggerService],
    };

    const interceptorProviders: Provider[] =
      LoggerModule.buildInterceptorProviders(opts);

    return {
      module: LoggerModule,
      providers: [
        loggerOptionsProvider,
        loggerServiceProvider,
        middlewareProvider,
        ...interceptorProviders,
      ],
      exports: [LoggerService, HttpLoggingMiddleware, PerformanceInterceptor],
    };
  }

  // -------------------------------------------------------------------------
  // Async registration
  // -------------------------------------------------------------------------

  static forRootAsync(asyncOpts: LoggerModuleAsyncOptions): DynamicModule {
    const loggerOptionsProvider: Provider = {
      provide: LOGGER_OPTIONS,
      useFactory: asyncOpts.useFactory,
      inject: asyncOpts.inject ?? [],
    };

    const loggerServiceProvider: Provider = {
      provide: LoggerService,
      useFactory: (options: LoggerRootOptions) => {
        const svc = new LoggerService(options);
        if (options.enableCloudWatch !== false) {
          createCloudWatchTransport(svc.winstonLogger);
        }
        if (options.enableElk !== false) {
          createElkTransport(svc.winstonLogger);
        }
        return svc;
      },
      inject: [LOGGER_OPTIONS],
    };

    const middlewareProvider: Provider = {
      provide: HttpLoggingMiddleware,
      useFactory: (svc: LoggerService) => new HttpLoggingMiddleware(svc),
      inject: [LoggerService],
    };

    return {
      module: LoggerModule,
      imports: asyncOpts.imports ?? [],
      providers: [
        loggerOptionsProvider,
        loggerServiceProvider,
        middlewareProvider,
        {
          provide: APP_INTERCEPTOR,
          useFactory: (svc: LoggerService) =>
            new PerformanceInterceptor(svc, { thresholdMs: 1000 }),
          inject: [LoggerService],
        },
      ],
      exports: [LoggerService, HttpLoggingMiddleware, PerformanceInterceptor],
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private static buildInterceptorProviders(
    opts: LoggerRootOptions,
  ): Provider[] {
    if (opts.enablePerformanceInterceptor === false) return [];

    return [
      {
        provide: APP_INTERCEPTOR,
        useFactory: (svc: LoggerService) =>
          new PerformanceInterceptor(svc, opts.performanceConfig ?? {}),
        inject: [LoggerService],
      },
    ];
  }
}
