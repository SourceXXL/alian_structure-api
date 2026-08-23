import {
  Module,
  NestModule,
  MiddlewareConsumer,
  OnModuleInit,
  Inject,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { join } from "path";
import { APP_GUARD } from "@nestjs/core";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { EnvironmentVariables } from "./config/env.validation";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";

// Modules – core
import { AuthModule } from "./core/auth/auth.module";
import { UserModule } from "./core/user/user.module";
import { ProfileModule } from "./core/profile/profile.module";

// Modules – infrastructure
import { AuditModule } from "./infrastructure/audit/audit.module";

// Modules – blockchain
import { OracleModule } from "./blockchain/oracle/oracle.module";

// Modules – investment
import { PortfolioModule } from "./investment/portfolio/portfolio.module";
import { RiskManagementModule } from "./investment/risk-management/risk-management.module";

// Modules – defi
import { DeFiModule } from "./defi/defi.module";

// Modules – growth
import { AlertsModule } from "./growth/alerts/alerts.module";

// Modules – health
import { HealthModule } from "./health/health.module";
// Modules – observability
import { ObservabilityModule } from "./observability/observability.module";
// Modules – monitoring
import { MonitoringModule } from "./monitoring/monitoring.module";
// Modules – profiling
import { ProfilingModule } from "./profiling/profiling.module";
// Modules - email
import { EmailModule } from "./email/email.module";
// Modules – logging
import { LoggerModule } from "./logging/logger.module";
// Modules – cache
import { CacheModule } from "./common/cache/cache.module";
import { BillingModule } from "./billing/billing.module";
// Modules – payments (plugin system)
import { PaymentsModule } from "./payments/payments.module";
import { RateLimitingModule } from "./rate-limiting/rate-limiting.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";
// Modules – notifications
import { NotificationModule } from "./notifications/notification.module";

// Auth entities
import { User } from "./core/user/entities/user.entity";
import { EmailVerification } from "./core/auth/entities/email-verification.entity";
import { Wallet } from "./core/auth/entities/wallet.entity";

// Oracle entities
import { SignedPayload } from "./blockchain/oracle/entities/signed-payload.entity";
import { SubmissionNonce } from "./blockchain/oracle/entities/submission-nonce.entity";
import { PriceRecord } from "./blockchain/oracle/entities/price-record.entity";

// Audit entities
import { AgentEvent } from "./infrastructure/audit/entities/agent-event.entity";
import { ComputeResult } from "./infrastructure/audit/entities/compute-result.entity";
import { ProvenanceRecord } from "./infrastructure/audit/entities/provenance-record.entity";
import { OracleSubmission } from "./infrastructure/audit/entities/oracle-submission.entity";

// Portfolio entities
import { Portfolio } from "./investment/portfolio/entities/portfolio.entity";
import { PortfolioAsset } from "./investment/portfolio/entities/portfolio-asset.entity";
import { Transaction } from "./investment/portfolio/entities/transaction.entity";
import { RiskProfile } from "./investment/portfolio/entities/risk-profile.entity";
import { OptimizationHistory } from "./investment/portfolio/entities/optimization-history.entity";
import { RebalancingEvent } from "./investment/portfolio/entities/rebalancing-event.entity";
import { PerformanceMetric } from "./investment/portfolio/entities/performance-metric.entity";
import { BacktestResult } from "./investment/portfolio/entities/backtest-result.entity";
// Email entity
import { EmailLog } from "./email/entities/email-log.entity";

// DeFi entities
import { DeFiPosition } from "./defi/entities/defi-position.entity";
import { DeFiYieldRecord } from "./defi/entities/defi-yield-record.entity";
import { DeFiTransaction } from "./defi/entities/defi-transaction.entity";
import { DeFiYieldStrategy } from "./defi/entities/defi-yield-strategy.entity";
import { DeFiRiskAssessment } from "./defi/entities/defi-risk-assessment.entity";

// Alerts entities
import { Alert } from "./growth/alerts/entities/alert.entity";
import { AlertTriggerLog } from "./growth/alerts/entities/alert-trigger-log.entity";
import { AlertPreference } from "./growth/alerts/entities/alert-preference.entity";

// Discovery entities
import { AgentReview } from "./discovery/reviews/entities/agent-review.entity";
import { AgentReviewsModule } from "./discovery/reviews/agent-reviews.module";

// Webhook entities
import { WebhookSubscription } from "./infrastructure/webhooks/entities/webhook-subscription.entity";
import { WebhookEvent } from "./infrastructure/webhooks/entities/webhook-event.entity";
import { WebhookDelivery } from "./infrastructure/webhooks/entities/webhook-delivery.entity";
import { WebhookDeadLetter } from "./infrastructure/webhooks/entities/webhook-dead-letter.entity";
// File upload entities
import { UploadedFile } from "./infrastructure/file-upload/entities/uploaded-file.entity";
import { FileThumbnail } from "./infrastructure/file-upload/entities/file-thumbnail.entity";
import { FileScanResult } from "./infrastructure/file-upload/entities/file-scan-result.entity";
// Reconciliation entities
import { ReconciliationAudit } from "./reconciliation/entities/reconciliation-audit.entity";
import { ReconciliationInvoice } from "./reconciliation/entities/reconciliation-invoice.entity";
import { StellarTransaction } from "./reconciliation/entities/stellar-transaction.entity";
// Notification entities
import { Notification } from "./notifications/entities/notification.entity";
import { NotificationTemplate } from "./notifications/entities/notification-template.entity";
import { NotificationPreference } from "./notifications/entities/notification-preference.entity";
import { NotificationAggregation } from "./notifications/entities/notification-aggregation.entity";
import { NotificationDeliveryLog } from "./notifications/entities/notification-delivery-log.entity";
import { NotificationAnalytics } from "./notifications/entities/notification-analytics.entity";
// Modules – webhooks
import { WebhookModule } from "./infrastructure/webhooks/webhook.module";
// Modules – file upload
import { FileUploadModule } from "./infrastructure/file-upload/file-upload.module";

// Guards
import { APP_FILTER } from "@nestjs/core";
import { DistributedRateLimitGuard } from "./rate-limiting/rate-limiting.guard";
import { RolesGuard } from "./common/guard/roles.guard";
import { KycGuard } from "./common/guard/kyc.guard";
import { StrategyAuthGuard } from "./core/auth/guards/strategy-auth.guard";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { SubmissionVerifierService } from "./blockchain/oracle/submission-verifier.service";
import { SearchModule } from "./search/search.module";
import { LoggingMiddleware } from "./common/middleware/logging.middleware";
import { ProfilingMiddleware } from "./profiling/profiling.middleware";
import { GraphqlGatewayModule } from "./graphql/graphql.module";
import { ModuleRegistryModule } from "./modules/registry/module-registry.module";
import { ModuleEntity } from "./modules/registry/entities/module.entity";
import { TenantModuleState } from "./modules/registry/entities/tenant-module-state.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, "..", ".env"),
      validate: async (config: Record<string, unknown>) => {
        const validatedConfig = plainToInstance(EnvironmentVariables, config, {
          enableImplicitConversion: true,
        });
        const errors = await validate(validatedConfig, {
          whitelist: true,
        });
        if (errors.length > 0) {
          throw new Error(
            `Environment validation failed: ${errors
              .map((e) => Object.values(e.constraints || {}).join(", "))
              .join(", ")}`
          );
        }
        return validatedConfig;
      },
    }),

    // ✅ ONLY ONE TypeORM CONFIG (Async)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get("NODE_ENV") === "production";

        if (isProduction && !configService.get("DATABASE_URL")) {
          throw new Error("DATABASE_URL must be set in production");
        }

        // Use DATABASE_URL from environment if available, otherwise fall back to individual settings
        const databaseUrl = configService.get<string>("DATABASE_URL");
        return {
          type: "postgres",
          url: databaseUrl, // TypeORM can directly parse the DATABASE_URL string
          host: "localhost",
          port: 5432,
          username: "postgres",
          password: "BNG482@AA",
          database: "swaptrade",
          entities: [
            User,
            EmailVerification,
            Wallet,
            SignedPayload,
            SubmissionNonce,
            PriceRecord,
            AgentEvent,
            ComputeResult,
            ProvenanceRecord,
            OracleSubmission,
            Portfolio,
            PortfolioAsset,
            Transaction,
            RiskProfile,
            OptimizationHistory,
            RebalancingEvent,
            PerformanceMetric,
            BacktestResult,
            DeFiPosition,
            DeFiYieldRecord,
            DeFiTransaction,
            DeFiYieldStrategy,
            DeFiRiskAssessment,
            Alert,
            AlertTriggerLog,
            AlertPreference,
            EmailLog,
            AgentReview,
            WebhookSubscription,
            WebhookEvent,
            WebhookDelivery,
            WebhookDeadLetter,
            UploadedFile,
            FileThumbnail,
            FileScanResult,
            ModuleEntity,
            TenantModuleState,
            ReconciliationAudit,
            ReconciliationInvoice,
            StellarTransaction,
            Notification,
            NotificationTemplate,
            NotificationPreference,
            NotificationAggregation,
            NotificationDeliveryLog,
            NotificationAnalytics,
          ],
          synchronize: true,
          logging: true,
          ssl: isProduction ? { rejectUnauthorized: false } : false,
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
          migrationsRun: false,
        };
      },
    }),

    EventEmitterModule.forRoot(),

    AuthModule,
    UserModule,
    ProfileModule,
    AuditModule,
    OracleModule,
    PortfolioModule,
    RiskManagementModule,
    DeFiModule,
    AlertsModule,
    HealthModule,
    ObservabilityModule,
    MonitoringModule,
    ProfilingModule,
    EmailModule,
    AgentReviewsModule,
    SearchModule,
    GraphqlGatewayModule,
    WebhookModule,
    FileUploadModule,
    ModuleRegistryModule,
    CacheModule,
    RateLimitingModule.forRoot(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        serviceName: cfg.get<string>("SERVICE_NAME") ?? "alian-structure-api",
        level: (cfg.get<string>("LOG_LEVEL") ?? "info") as any,
        logFileDir: cfg.get<string>("LOG_FILE_DIR"),
        enableCloudWatch: true,
        enableElk: true,
        enablePerformanceInterceptor: true,
        performanceConfig: { thresholdMs: 1000 },
      }),
    }),
    BillingModule,
    PaymentsModule,
    ReconciliationModule,
    NotificationModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: StrategyAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DistributedRateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: KycGuard,
    },
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(
    @Inject(SubmissionVerifierService)
    private readonly verifier: SubmissionVerifierService
  ) {}

  configure(consumer: MiddlewareConsumer) {
    // Create LoggingMiddleware instance manually to fix dependency injection issue
    const loggingMiddleware = new LoggingMiddleware();
    consumer
      .apply(
        (req, res, next) => loggingMiddleware.use(req, res, next),
        ProfilingMiddleware
      )
      .forRoutes("*");
  }

  onModuleInit() {
    this.verifier.start();
  }
}
