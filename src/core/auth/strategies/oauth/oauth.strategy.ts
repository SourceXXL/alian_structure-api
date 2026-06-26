import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AuthStrategy,
  AuthResult,
  AuthPayload,
  OAuthCredentials,
} from "../interfaces/auth-strategy.interface";
import { User } from "src/core/user/entities/user.entity";
import { SocialAccount, SocialProvider } from "../../entities/social-account.entity";
import { AuditLogService } from "src/infrastructure/audit/audit-log.service";

interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

interface OAuthUserInfo {
  id: string;
  email: string | null;
  name?: string;
  picture?: string;
}

@Injectable()
export class OAuthStrategy implements AuthStrategy {
  readonly name = "oauth";
  private readonly logger = new Logger(OAuthStrategy.name);
  private readonly providers = new Map<string, OAuthProviderConfig>();

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(SocialAccount)
    private readonly socialAccountRepository: Repository<SocialAccount>,
    private readonly auditLogService: AuditLogService,
  ) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    if (this.configService.get<string>("OAUTH_GOOGLE_CLIENT_ID")) {
      this.providers.set("google", {
        clientId: this.configService.get<string>("OAUTH_GOOGLE_CLIENT_ID")!,
        clientSecret: this.configService.get<string>("OAUTH_GOOGLE_CLIENT_SECRET")!,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
        scopes: ["openid", "email", "profile"],
      });
    }

    if (this.configService.get<string>("OAUTH_GITHUB_CLIENT_ID")) {
      this.providers.set("github", {
        clientId: this.configService.get<string>("OAUTH_GITHUB_CLIENT_ID")!,
        clientSecret: this.configService.get<string>("OAUTH_GITHUB_CLIENT_SECRET")!,
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        userInfoUrl: "https://api.github.com/user",
        scopes: ["user:email", "read:user"],
      });
    }

    if (this.configService.get<string>("OAUTH_TWITTER_CLIENT_ID")) {
      this.providers.set("twitter", {
        clientId: this.configService.get<string>("OAUTH_TWITTER_CLIENT_ID")!,
        clientSecret: this.configService.get<string>("OAUTH_TWITTER_CLIENT_SECRET")!,
        authorizationUrl: "https://twitter.com/i/oauth2/authorize",
        tokenUrl: "https://api.twitter.com/2/oauth2/token",
        userInfoUrl: "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
        scopes: ["tweet.read", "users.read"],
      });
    }

    this.logger.log(`Initialized ${this.providers.size} OAuth providers`);
  }

  get isEnabled(): boolean {
    return (
      this.configService.get<boolean>("AUTH_OAUTH_ENABLED", false) &&
      this.providers.size > 0
    );
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  getAuthorizationUrl(provider: string, state: string): string {
    const config = this.providers.get(provider);
    if (!config) {
      throw new BadRequestException(`Unsupported OAuth provider: ${provider}`);
    }

    const redirectUri = this.configService.get<string>(
      "OAUTH_REDIRECT_URI",
      "http://localhost:3000/auth/oauth/callback",
    );

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${redirectUri}/${provider}`,
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
    });

    return `${config.authorizationUrl}?${params.toString()}`;
  }

  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { provider, code } = credentials as OAuthCredentials;

    if (!provider || !code) {
      throw new BadRequestException("Provider and authorization code are required");
    }

    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported OAuth provider: ${provider}`);
    }

    try {
      const accessToken = await this.exchangeCodeForToken(providerConfig, provider, code);
      const userInfo = await this.getUserInfo(providerConfig, provider, accessToken);
      const user = await this.findOrCreateUser(userInfo, provider);

      await this.auditLogService.recordVerification({
        action: "oauth_login",
        userId: user.id,
        provider,
        email: userInfo.email,
        timestamp: new Date().toISOString(),
      });

      return this.issueToken(user, provider);
    } catch (error) {
      await this.auditLogService.recordVerification({
        action: "oauth_login_failed",
        provider,
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  async linkProvider(userId: string, provider: string, code: string): Promise<{ message: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported OAuth provider: ${provider}`);
    }

    const accessToken = await this.exchangeCodeForToken(providerConfig, provider, code);
    const userInfo = await this.getUserInfo(providerConfig, provider, accessToken);

    const existingSocial = await this.socialAccountRepository.findOne({
      where: { provider: provider as SocialProvider, providerUserId: userInfo.id },
    });

    if (existingSocial && existingSocial.userId !== userId) {
      throw new BadRequestException(
        `This ${provider} account is already linked to another user`,
      );
    }

    if (!existingSocial) {
      const social = this.socialAccountRepository.create({
        userId,
        provider: provider as SocialProvider,
        providerUserId: userInfo.id,
        email: userInfo.email,
        displayName: userInfo.name,
        avatarUrl: userInfo.picture,
        emailVerified: !!userInfo.email,
      });
      await this.socialAccountRepository.save(social);
    }

    await this.auditLogService.recordVerification({
      action: "oauth_account_linked",
      userId,
      provider,
      timestamp: new Date().toISOString(),
    });

    return { message: `${provider} account linked successfully` };
  }

  async unlinkProvider(userId: string, provider: string): Promise<{ message: string }> {
    const social = await this.socialAccountRepository.findOne({
      where: { userId, provider: provider as SocialProvider },
    });

    if (!social) {
      throw new BadRequestException(`No ${provider} account linked to this user`);
    }

    await this.socialAccountRepository.remove(social);

    await this.auditLogService.recordVerification({
      action: "oauth_account_unlinked",
      userId,
      provider,
      timestamp: new Date().toISOString(),
    });

    return { message: `${provider} account unlinked successfully` };
  }

  async getLinkedProviders(userId: string): Promise<{ provider: string; email: string | null; linkedAt: Date }[]> {
    const accounts = await this.socialAccountRepository.find({ where: { userId } });
    return accounts.map((a) => ({
      provider: a.provider,
      email: a.email,
      linkedAt: a.createdAt,
    }));
  }

  private async exchangeCodeForToken(
    config: OAuthProviderConfig,
    provider: string,
    code: string,
  ): Promise<string> {
    const redirectUri = this.configService.get<string>(
      "OAUTH_REDIRECT_URI",
      "http://localhost:3000/auth/oauth/callback",
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (provider === "twitter") {
      const credentials = Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64");
      headers["Authorization"] = `Basic ${credentials}`;
    }

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${redirectUri}/${provider}`,
      }),
    });

    if (!response.ok) {
      this.logger.error(`Token exchange failed for ${provider}: ${response.status}`);
      throw new UnauthorizedException("Failed to exchange OAuth code for token");
    }

    const data = await response.json();
    return data.access_token;
  }

  private async getUserInfo(
    config: OAuthProviderConfig,
    provider: string,
    accessToken: string,
  ): Promise<OAuthUserInfo> {
    const response = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new UnauthorizedException("Failed to fetch user info from OAuth provider");
    }

    const data = await response.json();

    if (provider === "twitter") {
      const twitterUser = data.data || data;
      return {
        id: twitterUser.id,
        email: null,
        name: twitterUser.name,
        picture: twitterUser.profile_image_url,
      };
    }

    return {
      id: String(data.id || data.sub),
      email: data.email || null,
      name: data.name || data.login,
      picture: data.picture || data.avatar_url,
    };
  }

  private async findOrCreateUser(userInfo: OAuthUserInfo, provider: string): Promise<User> {
    const existingSocial = await this.socialAccountRepository.findOne({
      where: { provider: provider as SocialProvider, providerUserId: userInfo.id },
      relations: ["user"],
    });

    if (existingSocial) {
      return existingSocial.user;
    }

    let user: User | null = null;
    if (userInfo.email) {
      user = await this.userRepository.findOne({ where: { email: userInfo.email } });
    }

    if (!user) {
      user = this.userRepository.create({
        email: userInfo.email,
        username: userInfo.name
          ? `${userInfo.name.replace(/\s+/g, "_").toLowerCase()}_${Math.random().toString(36).slice(2, 6)}`
          : `${provider}_${userInfo.id}`,
        walletAddress: `oauth_${provider}_${userInfo.id}`,
        emailVerified: !!userInfo.email,
      });
      await this.userRepository.save(user);
      this.logger.log(`Created new user from OAuth (${provider}): ${userInfo.email}`);
    }

    const social = this.socialAccountRepository.create({
      userId: user.id,
      provider: provider as SocialProvider,
      providerUserId: userInfo.id,
      email: userInfo.email,
      displayName: userInfo.name,
      avatarUrl: userInfo.picture,
      emailVerified: !!userInfo.email,
    });
    await this.socialAccountRepository.save(social);

    return user;
  }

  private issueToken(user: User, provider: string): AuthResult {
    const payload: AuthPayload = {
      sub: user.id,
      email: user.email ?? undefined,
      username: user.username ?? undefined,
      role: user.role || "user",
      iat: Math.floor(Date.now() / 1000),
      type: "oauth",
    };

    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        email: user.email ?? undefined,
        username: user.username ?? undefined,
        role: user.role || "user",
        type: "oauth",
      },
    };
  }

  async validateToken(token: string): Promise<AuthPayload | null> {
    try {
      return this.jwtService.verify(token) as AuthPayload;
    } catch {
      return null;
    }
  }
}
