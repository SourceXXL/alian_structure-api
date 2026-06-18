import { Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { join } from "path";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
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

// Auth entities
import { User } from "./core/user/entities/user.entity";
import { EmailVerification } from "./core/auth/entities/email-verification.entity";
import { Wallet } from "./core/auth/entities/wallet.entity";

// Oracle entities
import { SignedPayload } from "./blockchain/oracle/entities/signed-payload.entity";
import { SubmissionNonce } from "./blockchain/oracle/entities/submission-nonce.entity";

// Audit entities
import { AgentEvent } from "./infrastructure/audit/entities/agent-event.entity";
import { ComputeResult } from "./infrastructure/audit/entities/compute-result.entity";
import { ProvenanceRecord } from "./infrastructure/audit/entities/provenance-record.entity";

// Portfolio entities
import { Portfolio } from "./investment/portfolio/entities/portfolio.entity";
import { PortfolioAsset } from "./investment/portfolio/entities/portfolio-asset.entity";
import { RiskProfile } from "./investment/portfolio/entities/risk-profile.entity";
import { OptimizationHistory } from "./investment/portfolio/entities/optimization-history.entity";
import { RebalancingEvent } from "./investment/portfolio/entities/rebalancing-event.entity";
import { PerformanceMetric } from "./investment/portfolio/entities/performance-metric.entity";
import { BacktestResult } from "./investment/portfolio/entities/backtest-result.entity";

// DeFi entities
import { DeFiPosition } from "./defi/entities/defi-position.entity";
import { DeFiYieldRecord } from "./defi/entities/defi-yield-record.entity";
import { DeFiTransaction } from "./defi/entities/defi-transaction.entity";
import { DeFiYieldStrategy } from "./defi/entities/defi-yield-strategy.entity";
import { DeFiRiskAssessment } from "./defi/entities/defi-risk-assessment.entity";

// Alerts entities
import { Alert } from "./growth/alerts/entities/alert.entity";
import { AlertTriggerLog } from "./growth/alerts/entities/alert-trigger-log.entity";

// Guards
import { APP_FILTER } from "@nestjs/core";
import { ThrottlerUserIpGuard } from "./common/guard/throttler.guard";
import { RolesGuard } from "./common/guard/roles.guard";
import { KycGuard } from "./common/guard/kyc.guard";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { SubmissionVerifierService } from "./blockchain/oracle/submission-verifier.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' 
        ? join(__dirname, '..', '.env')
        : '.env',
      validate: async (config: Record<string, unknown>) => {
        const validatedConfig = plainToInstance(EnvironmentVariables, config, {
          enableImplicitConversion: true,
        });
        const errors = await validate(validatedConfig, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        if (errors.length > 0) {
          throw new Error(
            `Environment validation failed: ${errors
              .map((e) => Object.values(e.constraints || {}).join(", "))
              .join(", ")}`,
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

        return {
          type: "postgres",
          url:
            configService.get("DATABASE_URL") ||
            "postgresql://stellaiverse:password@localhost:5432/stellaiverse",
          entities: [
            User,
            EmailVerification,
            Wallet,
            SignedPayload,
            SubmissionNonce,
            AgentEvent,
            ComputeResult,
            ProvenanceRecord,
            Portfolio,
            PortfolioAsset,
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
          ],
          synchronize: !isProduction,
          logging: isProduction ? ["error"] : ["error", "warn", "schema"],
          ssl: isProduction ? { rejectUnauthorized: false } : false,
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
          },
        };
      },
    }),

    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'global',  ttl: 60_000, limit: 100 },
        { name: 'auth',    ttl: 60_000, limit: 5   },
        { name: 'trading', ttl: 60_000, limit: 20  },
        { name: 'oracle',  ttl: 60_000, limit: 10  },
      ],
    }),

    AuthModule,
    UserModule,
    ProfileModule,
    AuditModule,
    OracleModule,
    PortfolioModule,
    RiskManagementModule,
    DeFiModule,
    AlertsModule,
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
      useClass: ThrottlerUserIpGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: KycGuard,
    },
    SubmissionVerifierService,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly verifier: SubmissionVerifierService) {}

  onModuleInit() {
    this.verifier.start();
  }
}