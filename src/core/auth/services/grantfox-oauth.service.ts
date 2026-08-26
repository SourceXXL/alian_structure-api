import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThan } from "typeorm";
import { randomBytes, createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { User } from "src/core/user/entities/user.entity";
import { GrantfoxToken } from "../entities/grantfox-token.entity";
import { SocialAccount } from "../entities/social-account.entity";
import { AuditLogService } from "src/infrastructure/audit/audit-log.service";
import { resolveRateLimitTierFromRole } from "src/config/quota.config";
import { normalizeRole } from "src/common/guard/roles.enum";

interface GrantfoxTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

interface GrantfoxUserInfo {
  sub: string;
  email?: string;
  name?: string;
  org_name?: string;
  entitlements?: string[];
  billing_permissions?: string[];
}

export interface GrantfoxAuthStartResult {
  authorizationUrl: string;
  state: string;
}

export interface GrantfoxAuthCallbackResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email?: string;
    username?: string;
    role: string;
    tier?: string;
  };
  entitlements: string[];
  billingPermissions: string[];
}

@Injectable()
export class GrantfoxOAuthService {
  private readonly logger = new Logger(GrantfoxOAuthService.name);

  /** Default access token lifetime if not specified by the provider. */
  private readonly DEFAULT_ACCESS_TOKEN_TTL = 3600; // 1 hour
  /** Default refresh token lifetime if not specified by the provider. */
  private readonly DEFAULT_REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(GrantfoxToken)
    private readonly grantfoxTokenRepository: Repository<GrantfoxToken>,
    @InjectRepository(SocialAccount)
    private readonly socialAccountRepository: Repository<SocialAccount>,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ─── PKCE Helpers ──────────────────────────────────────────────────────

  /** Generate a cryptographically random code verifier (43–128 chars, base64url). */
  generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url");
  }

  /** Derive the S256 code challenge from a verifier. */
  generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  // ─── URLs ──────────────────────────────────────────────────────────────

  private get authorizationUrl(): string {
    return this.configService.get<string>(
      "GRANTFOX_AUTHORIZATION_URL",
      "https://auth.grantfox.io/oauth/authorize",
    );
  }

  private get tokenUrl(): string {
    return this.configService.get<string>(
      "GRANTFOX_TOKEN_URL",
      "https://auth.grantfox.io/oauth/token",
    );
  }

  private get userInfoUrl(): string {
    return this.configService.get<string>(
      "GRANTFOX_USERINFO_URL",
      "https://auth.grantfox.io/oauth/userinfo",
    );
  }

  private get revokeUrl(): string {
    return this.configService.get<string>(
      "GRANTFOX_REVOKE_URL",
      "https://auth.grantfox.io/oauth/revoke",
    );
  }

  private get clientId(): string {
    return this.configService.get<string>("GRANTFOX_CLIENT_ID") || "";
  }

  private get clientSecret(): string {
    return this.configService.get<string>("GRANTFOX_CLIENT_SECRET") || "";
  }

  private get redirectUri(): string {
    return this.configService.get<string>(
      "GRANTFOX_REDIRECT_URI",
      "http://localhost:3000/auth/grantfox/callback",
    );
  }

  // ─── Authorization Start ───────────────────────────────────────────────

  /**
   * Generate the PKCE authorization URL and persist the code verifier
   * temporarily (stored in-memory via the OAuth state → mapped to the
   * verifier in the grantfox_tokens table with a null userId until callback).
   *
   * Returns `{ authorizationUrl, state }` for the client to redirect to.
   */
  async startAuthorization(
    scopes: string[] = ["openid", "profile", "entitlements"],
  ): Promise<GrantfoxAuthStartResult> {
    const state = uuidv4();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Persist the state ↔ verifier mapping (userId will be filled on callback)
    const pendingToken = this.grantfoxTokenRepository.create({
      userId: "00000000-0000-0000-0000-000000000000", // placeholder until callback
      grantfoxUserId: state, // use state as a temporary key
      accessToken: "", // will be replaced on callback
      refreshToken: "", // will be replaced on callback
      accessTokenExpiresAt: new Date(), // placeholder
      refreshTokenExpiresAt: new Date(), // placeholder
      codeVerifier,
      oauthState: state,
    });
    await this.grantfoxTokenRepository.save(pendingToken);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: scopes.join(" "),
    });

    const authorizationUrl = `${this.authorizationUrl}?${params.toString()}`;

    this.logger.log(`Grantfox OAuth start: state=${state}`);

    return { authorizationUrl, state };
  }

  // ─── Authorization Callback ────────────────────────────────────────────

  /**
   * Exchange the authorization code for tokens, fetch user info, and
   * find-or-create the internal user. Implements refresh token rotation
   * from the start (each callback creates a new token record).
   */
  async handleCallback(
    code: string,
    state: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<GrantfoxAuthCallbackResult> {
    // 1. Retrieve and validate the pending state
    const pendingToken = await this.grantfoxTokenRepository.findOne({
      where: { oauthState: state },
    });

    if (!pendingToken) {
      throw new BadRequestException(
        "Invalid or expired OAuth state. Please start the authorization flow again.",
      );
    }

    const codeVerifier = pendingToken.codeVerifier;

    // 2. Exchange authorization code for tokens
    const tokenResponse = await this.exchangeCodeForToken(code, codeVerifier);

    // 3. Fetch user info from Grantfox
    const grantfoxUser = await this.fetchUserInfo(tokenResponse.access_token);

    // 4. Find or create the internal user
    const user = await this.findOrCreateUser(grantfoxUser);

    // 5. Store the tokens (with encrypted refresh token)
    const now = new Date();
    const accessTokenExpiresAt = new Date(
      now.getTime() + (tokenResponse.expires_in || this.DEFAULT_ACCESS_TOKEN_TTL) * 1000,
    );
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.DEFAULT_REFRESH_TOKEN_TTL * 1000,
    );

    // Remove the placeholder pending record
    await this.grantfoxTokenRepository.remove(pendingToken);

    const grantfoxToken = this.grantfoxTokenRepository.create({
      userId: user.id,
      grantfoxUserId: grantfoxUser.sub,
      grantfoxOrgName: grantfoxUser.org_name || null,
      entitlements: grantfoxUser.entitlements || null,
      billingPermissions: grantfoxUser.billing_permissions || null,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    });
    await this.grantfoxTokenRepository.save(grantfoxToken);

    // 6. Link social account
    await this.linkSocialAccount(user.id, grantfoxUser);

    // 7. Audit log
    await this.auditLogService.recordVerification({
      action: "grantfox_oauth_login",
      userId: user.id,
      grantfoxUserId: grantfoxUser.sub,
      email: grantfoxUser.email,
      timestamp: now.toISOString(),
    });

    this.logger.log(
      `Grantfox OAuth callback successful for user ${user.id}, grantfox=${grantfoxUser.sub}`,
    );

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      user: {
        id: user.id,
        email: user.email ?? undefined,
        username: user.username ?? undefined,
        role: normalizeRole(user.role),
        tier: resolveRateLimitTierFromRole(user.role),
      },
      entitlements: grantfoxUser.entitlements || [],
      billingPermissions: grantfoxUser.billing_permissions || [],
    };
  }

  // ─── Token Refresh (with rotation) ────────────────────────────────────

  /**
   * Exchange a valid refresh token for a new access + refresh token pair.
   * The old refresh token is revoked and the new one stored (rotation).
   */
  async refreshToken(
    refreshTokenValue: string,
    ipAddress: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const tokenEntity = await this.grantfoxTokenRepository.findOne({
      where: { refreshToken: refreshTokenValue, revoked: false },
    });

    if (!tokenEntity) {
      throw new UnauthorizedException("Invalid or revoked refresh token");
    }

    if (tokenEntity.refreshTokenExpiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token has expired");
    }

    try {
      // Call Grantfox token endpoint with refresh_token grant
      const response = await fetch(this.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshTokenValue,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Grantfox token refresh failed (${response.status}): ${errorBody}`,
        );
        // Revoke the token on error to prevent reuse
        tokenEntity.revoked = true;
        tokenEntity.revokedAt = new Date();
        await this.grantfoxTokenRepository.save(tokenEntity);
        throw new UnauthorizedException("Failed to refresh Grantfox token");
      }

      const newTokens: GrantfoxTokenResponse = await response.json();
      const now = new Date();

      // Revoke old token (rotation)
      tokenEntity.revoked = true;
      tokenEntity.revokedAt = now;
      tokenEntity.replacedByToken = "rotated";
      await this.grantfoxTokenRepository.save(tokenEntity);

      // Store new tokens
      const accessTokenExpiresAt = new Date(
        now.getTime() +
          (newTokens.expires_in || this.DEFAULT_ACCESS_TOKEN_TTL) * 1000,
      );
      const refreshTokenExpiresAt = new Date(
        now.getTime() + this.DEFAULT_REFRESH_TOKEN_TTL * 1000,
      );

      const newTokenEntity = this.grantfoxTokenRepository.create({
        userId: tokenEntity.userId,
        grantfoxUserId: tokenEntity.grantfoxUserId,
        grantfoxOrgName: tokenEntity.grantfoxOrgName,
        entitlements: tokenEntity.entitlements,
        billingPermissions: tokenEntity.billingPermissions,
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      });
      await this.grantfoxTokenRepository.save(newTokenEntity);

      this.logger.log(
        `Grantfox token rotated for user ${tokenEntity.userId}`,
      );

      return {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresIn: newTokens.expires_in || this.DEFAULT_ACCESS_TOKEN_TTL,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error during Grantfox token refresh: ${(error as Error).message}`,
      );
      throw new InternalServerErrorException("Failed to refresh Grantfox token");
    }
  }

  // ─── Token Revocation ─────────────────────────────────────────────────

  /**
   * Revoke a specific refresh token or all tokens for a user.
   * Also calls the Grantfox revocation endpoint.
   */
  async revokeToken(
    userId: string,
    refreshTokenValue?: string,
  ): Promise<{ revoked: boolean; count: number }> {
    let count = 0;

    if (refreshTokenValue) {
      // Revoke specific token
      const tokenEntity = await this.grantfoxTokenRepository.findOne({
        where: { userId, refreshToken: refreshTokenValue, revoked: false },
      });

      if (!tokenEntity) {
        throw new BadRequestException(
          "Token not found or already revoked",
        );
      }

      // Revoke on Grantfox side (best-effort)
      await this.revokeOnGrantfox(tokenEntity.refreshToken);

      tokenEntity.revoked = true;
      tokenEntity.revokedAt = new Date();
      await this.grantfoxTokenRepository.save(tokenEntity);
      count = 1;
    } else {
      // Revoke all tokens for the user
      const activeTokens = await this.grantfoxTokenRepository.find({
        where: { userId, revoked: false },
      });

      for (const token of activeTokens) {
        await this.revokeOnGrantfox(token.refreshToken);
        token.revoked = true;
        token.revokedAt = new Date();
      }

      if (activeTokens.length > 0) {
        await this.grantfoxTokenRepository.save(activeTokens);
      }
      count = activeTokens.length;
    }

    this.logger.log(
      `Grantfox token revoked for user ${userId}: ${count} token(s)`,
    );

    return { revoked: true, count };
  }

  // ─── Identity Resolution ──────────────────────────────────────────────

  /**
   * Given an access token, find the associated internal user and
   * return their Grantfox identity/entitlements.
   */
  async resolveIdentity(
    accessToken: string,
  ): Promise<{
    userId: string;
    grantfoxUserId: string;
    entitlements: string[];
    billingPermissions: string[];
  } | null> {
    const tokenEntity = await this.grantfoxTokenRepository.findOne({
      where: { accessToken, revoked: false },
    });

    if (!tokenEntity) {
      return null;
    }

    return {
      userId: tokenEntity.userId,
      grantfoxUserId: tokenEntity.grantfoxUserId,
      entitlements: tokenEntity.entitlements || [],
      billingPermissions: tokenEntity.billingPermissions || [],
    };
  }

  /**
   * Get all active Grantfox tokens for a user.
   */
  async getUserTokens(
    userId: string,
  ): Promise<
    Array<{
      id: string;
      grantfoxUserId: string;
      grantfoxOrgName: string | null;
      entitlements: string[] | null;
      billingPermissions: string[] | null;
      accessTokenExpiresAt: Date;
      refreshTokenExpiresAt: Date;
      createdAt: Date;
    }>
  > {
    const tokens = await this.grantfoxTokenRepository.find({
      where: { userId, revoked: false },
      order: { createdAt: "DESC" },
    });

    return tokens.map((t) => ({
      id: t.id,
      grantfoxUserId: t.grantfoxUserId,
      grantfoxOrgName: t.grantfoxOrgName,
      entitlements: t.entitlements,
      billingPermissions: t.billingPermissions,
      accessTokenExpiresAt: t.accessTokenExpiresAt,
      refreshTokenExpiresAt: t.refreshTokenExpiresAt,
      createdAt: t.createdAt,
    }));
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private async exchangeCodeForToken(
    code: string,
    codeVerifier?: string | null,
  ): Promise<GrantfoxTokenResponse> {
    const body: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    };

    if (codeVerifier) {
      body.code_verifier = codeVerifier;
    }

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Grantfox token exchange failed (${response.status}): ${errorBody}`,
      );
      throw new UnauthorizedException(
        "Failed to exchange authorization code for token",
      );
    }

    return response.json();
  }

  private async fetchUserInfo(accessToken: string): Promise<GrantfoxUserInfo> {
    const response = await fetch(this.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      this.logger.error(
        `Grantfox userinfo request failed (${response.status})`,
      );
      throw new UnauthorizedException(
        "Failed to fetch user info from Grantfox",
      );
    }

    const data = await response.json();
    return {
      sub: data.sub || data.id,
      email: data.email,
      name: data.name,
      org_name: data.org_name || data.organization,
      entitlements: data.entitlements,
      billing_permissions: data.billing_permissions,
    };
  }

  private async findOrCreateUser(
    grantfoxUser: GrantfoxUserInfo,
  ): Promise<User> {
    // Check if a social account link already exists
    const existingSocial = await this.socialAccountRepository.findOne({
      where: {
        provider: "grantfox" as any,
        providerUserId: grantfoxUser.sub,
      },
      relations: ["user"],
    });

    if (existingSocial) {
      return existingSocial.user;
    }

    // Try to find by email
    let user: User | null = null;
    if (grantfoxUser.email) {
      user = await this.userRepository.findOne({
        where: { email: grantfoxUser.email },
      });
    }

    if (!user) {
      // Create a new user
      const username = grantfoxUser.name
        ? `${grantfoxUser.name.replace(/\s+/g, "_").toLowerCase()}_${Math.random().toString(36).slice(2, 6)}`
        : `grantfox_${grantfoxUser.sub}`;

      user = this.userRepository.create({
        email: grantfoxUser.email,
        username,
        walletAddress: `grantfox_${grantfoxUser.sub}`,
        emailVerified: !!grantfoxUser.email,
      });
      await this.userRepository.save(user);
      this.logger.log(
        `Created new user from Grantfox OAuth: ${grantfoxUser.email}`,
      );
    }

    return user;
  }

  private async linkSocialAccount(
    userId: string,
    grantfoxUser: GrantfoxUserInfo,
  ): Promise<void> {
    const existing = await this.socialAccountRepository.findOne({
      where: {
        userId,
        provider: "grantfox" as any,
        providerUserId: grantfoxUser.sub,
      },
    });

    if (!existing) {
      const social = this.socialAccountRepository.create({
        userId,
        provider: "grantfox" as any,
        providerUserId: grantfoxUser.sub,
        email: grantfoxUser.email,
        displayName: grantfoxUser.name,
        emailVerified: !!grantfoxUser.email,
      });
      await this.socialAccountRepository.save(social);
    }
  }

  private async revokeOnGrantfox(refreshToken: string): Promise<void> {
    try {
      const response = await fetch(this.revokeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          token: refreshToken,
          token_type_hint: "refresh_token",
        }),
      });

      if (!response.ok) {
        this.logger.warn(
          `Grantfox revocation endpoint returned ${response.status}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to revoke on Grantfox side: ${(error as Error).message}`,
      );
    }
  }
}
