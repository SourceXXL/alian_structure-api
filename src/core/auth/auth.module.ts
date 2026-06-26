import { SocialAccount } from "./entities/social-account.entity";
import { OAuthController } from "./oauth.controller";
import { AuditLogService } from "src/infrastructure/audit/audit-log.service";
import { Module, OnModuleInit } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { EnhancedAuthService } from "./enhanced-auth.service";
import { ChallengeService } from "./challenge.service";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt.guard";
import { WalletAuthService } from "./wallet-auth.service";
import { EmailService } from "./email.service";
import { EmailLinkingService } from "./email-linking.service";
import { RecoveryService } from "./recovery.service";
import { SessionRecoveryService } from "./session-recovery.service";
import { DelegationService } from "./delegation.service";
import { AuditModule } from "src/infrastructure/audit/audit.module";
import { StrategyAuthService } from "./strategy-auth.service";
import { StrategyRegistry } from "./strategies/strategy.registry";
import { WalletStrategy } from "./strategies/wallet/wallet.strategy";
import { TraditionalStrategy } from "./strategies/traditional/traditional.strategy";
import { OAuthStrategy } from "./strategies/oauth/oauth.strategy";
import { ApiKeyStrategy } from "./strategies/api-key/api-key.strategy";
import { StrategyAuthGuard } from "./guards/strategy-auth.guard";
import { AdminTwoFactorGuard } from "./guards/admin-two-factor.guard";
import { TokenBlacklistService } from "./token-blacklist.service";
import { User } from "../user/entities/user.entity";
import { EmailVerification } from "./entities/email-verification.entity";
import { Wallet } from "./entities/wallet.entity";
import { RefreshToken, TwoFactorAuth } from "./entities/auth.entity";

/**
 * AuthModule — Authentication Architecture Overview
 *
 * Three auth flows are supported:
 *
 * 1. **Legacy flow** (AuthService / WalletAuthService)
 *    - Email+password registration/login (AuthService) and wallet-signature login
 *      (WalletAuthService).  These services issue single short-lived JWTs and are
 *      retained for backward compatibility.  New code should NOT call them.
 *    - Token revocation is handled by `TokenBlacklistService` (AuthService.logout).
 *
 * 2. **Enhanced flow** (EnhancedAuthService)
 *    - Superset of the legacy flow: adds refresh-token rotation, TOTP/backup-code
 *      2FA, account-activity tracking, and proper revocation via
 *      `revokeAllRefreshTokens`.  Prefer this service for all new email+password
 *      features.
 *
 * 3. **Strategy flow** (StrategyAuthService + StrategyAuthGuard)
 *    - Pluggable, registry-driven system.  Strategies (WalletStrategy,
 *      TraditionalStrategy, OAuthStrategy, ApiKeyStrategy) are registered at
 *      module init and tried in sequence by `StrategyAuthGuard`.
 *    - `StrategyAuthGuard` is registered as a **global guard** in AppModule so
 *      every route is protected by default.  Mark public routes with `@Public()`.
 *    - Use `@AllowedStrategies('wallet', 'traditional')` to restrict which
 *      strategies are accepted on a per-route basis.
 */
@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "15m" },
      }),
    }),
    TypeOrmModule.forFeature([
      User,
      EmailVerification,
      Wallet,
      RefreshToken,
      TwoFactorAuth,
      SocialAccount,
    ]),
    AuditModule,
  ],
  controllers: [AuthController, OAuthController],
  providers: [
    // Legacy services (for backward compatibility)
    AuthService,
    ChallengeService,
    WalletAuthService,
    EmailService,
    EmailLinkingService,
    RecoveryService,
    SessionRecoveryService,
    DelegationService,
    // New enhanced services
    EnhancedAuthService,
    JwtStrategy,
    JwtAuthGuard,
    TokenBlacklistService,
    // New pluggable strategy system
    StrategyRegistry,
    StrategyAuthService,
    WalletStrategy,
    TraditionalStrategy,
    OAuthStrategy,
    ApiKeyStrategy,
    StrategyAuthGuard,
    AdminTwoFactorGuard,
    AuditLogService,
  ],
  exports: [
    // Legacy exports
    AuthService,
    ChallengeService,
    WalletAuthService,
    EmailLinkingService,
    SessionRecoveryService,
    DelegationService,
    JwtAuthGuard,
    TokenBlacklistService,
    // New enhanced exports
    EnhancedAuthService,
    // New pluggable strategy exports
    StrategyRegistry,
    StrategyAuthService,
    WalletStrategy,
    TraditionalStrategy,
    OAuthStrategy,
    ApiKeyStrategy,
    StrategyAuthGuard,
  ],
})
export class AuthModule implements OnModuleInit {
  constructor(
    private readonly strategyRegistry: StrategyRegistry,
    private readonly walletStrategy: WalletStrategy,
    private readonly traditionalStrategy: TraditionalStrategy,
    private readonly oauthStrategy: OAuthStrategy,
    private readonly apiKeyStrategy: ApiKeyStrategy,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  onModuleInit(): void {
    // Register all authentication strategies
    this.strategyRegistry.register(this.walletStrategy);
    this.strategyRegistry.register(this.traditionalStrategy);
    this.strategyRegistry.register(this.oauthStrategy);
    this.strategyRegistry.register(this.apiKeyStrategy);
  }
}
