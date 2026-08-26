// Mock @nestjs/schedule before any import that transitively depends on it
jest.mock("@nestjs/schedule", () => ({
  Cron: () => () => {},
  CronExpression: { EVERY_5_MINUTES: "*/5 * * * *" },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Repository } from "typeorm";
import {
  GrantfoxOAuthService,
} from "./grantfox-oauth.service";
import { GrantfoxToken } from "../entities/grantfox-token.entity";
import { User } from "src/core/user/entities/user.entity";
import { SocialAccount } from "../entities/social-account.entity";
import { AuditLogService } from "src/infrastructure/audit/audit-log.service";

describe("GrantfoxOAuthService", () => {
  let service: GrantfoxOAuthService;
  let grantfoxTokenRepo: jest.Mocked<Repository<GrantfoxToken>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let socialAccountRepo: jest.Mocked<Repository<SocialAccount>>;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        GRANTFOX_CLIENT_ID: "test-client-id",
        GRANTFOX_CLIENT_SECRET: "test-client-secret",
        GRANTFOX_AUTHORIZATION_URL: "https://auth.test.grantfox.io/oauth/authorize",
        GRANTFOX_TOKEN_URL: "https://auth.test.grantfox.io/oauth/token",
        GRANTFOX_USERINFO_URL: "https://auth.test.grantfox.io/oauth/userinfo",
        GRANTFOX_REVOKE_URL: "https://auth.test.grantfox.io/oauth/revoke",
        GRANTFOX_REDIRECT_URI: "http://localhost:3000/auth/grantfox/callback",
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue("mock-jwt-token"),
    verify: jest.fn(),
  };

  const mockAuditLogService = {
    recordVerification: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const mockRepo = () => ({
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrantfoxOAuthService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: getRepositoryToken(User), useValue: mockRepo() },
        {
          provide: getRepositoryToken(GrantfoxToken),
          useValue: mockRepo(),
        },
        {
          provide: getRepositoryToken(SocialAccount),
          useValue: mockRepo(),
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<GrantfoxOAuthService>(GrantfoxOAuthService);
    grantfoxTokenRepo = module.get(getRepositoryToken(GrantfoxToken));
    userRepo = module.get(getRepositoryToken(User));
    socialAccountRepo = module.get(getRepositoryToken(SocialAccount));
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("PKCE Helpers", () => {
    it("should generate a code verifier of the correct length", () => {
      const verifier = service.generateCodeVerifier();
      expect(verifier).toBeDefined();
      expect(typeof verifier).toBe("string");
      // base64url of 32 bytes = 43 characters
      expect(verifier.length).toBe(43);
      // Should be valid base64url (no +, /, or =)
      expect(verifier).not.toMatch(/[+/=]/);
    });

    it("should generate deterministic code challenges from the same verifier", () => {
      const verifier = "test-verifier-value";
      const challenge1 = service.generateCodeChallenge(verifier);
      const challenge2 = service.generateCodeChallenge(verifier);
      expect(challenge1).toBe(challenge2);
    });

    it("should generate different challenges for different verifiers", () => {
      const challenge1 = service.generateCodeChallenge("verifier-1");
      const challenge2 = service.generateCodeChallenge("verifier-2");
      expect(challenge1).not.toBe(challenge2);
    });

    it("code challenge should be a valid base64url string", () => {
      const challenge = service.generateCodeChallenge("some-input");
      expect(challenge).not.toMatch(/[+/=]/);
    });
  });

  describe("startAuthorization", () => {
    it("should generate an authorization URL with PKCE parameters", async () => {
      grantfoxTokenRepo.create.mockReturnValue({
        id: "pending-id",
        oauthState: "mock-state",
        codeVerifier: "mock-verifier",
      } as any);
      grantfoxTokenRepo.save.mockResolvedValue({} as any);

      const result = await service.startAuthorization();

      expect(result.authorizationUrl).toContain(
        "https://auth.test.grantfox.io/oauth/authorize",
      );
      expect(result.authorizationUrl).toContain("code_challenge_method=S256");
      expect(result.authorizationUrl).toContain("client_id=test-client-id");
      expect(result.authorizationUrl).toContain("response_type=code");
      expect(result.state).toBeDefined();
    });

    it("should include custom scopes when provided", async () => {
      grantfoxTokenRepo.create.mockReturnValue({} as any);
      grantfoxTokenRepo.save.mockResolvedValue({} as any);

      const result = await service.startAuthorization([
        "openid",
        "custom-scope",
      ]);

      expect(result.authorizationUrl).toContain("scope=openid+custom-scope");
    });

    it("should default to openid profile entitlements scopes", async () => {
      grantfoxTokenRepo.create.mockReturnValue({} as any);
      grantfoxTokenRepo.save.mockResolvedValue({} as any);

      const result = await service.startAuthorization();

      expect(result.authorizationUrl).toContain(
        "scope=openid+profile+entitlements",
      );
    });
  });

  describe("resolveIdentity", () => {
    it("should return null for invalid tokens", async () => {
      grantfoxTokenRepo.findOne.mockResolvedValue(null);

      const result = await service.resolveIdentity("invalid-token");

      expect(result).toBeNull();
    });

    it("should return identity for valid active tokens", async () => {
      grantfoxTokenRepo.findOne.mockResolvedValue({
        userId: "user-123",
        grantfoxUserId: "gf-user-123",
        entitlements: ["grant:read", "grant:write"],
        billingPermissions: ["billing:view"],
        revoked: false,
      } as any);

      const result = await service.resolveIdentity("valid-token");

      expect(result).toEqual({
        userId: "user-123",
        grantfoxUserId: "gf-user-123",
        entitlements: ["grant:read", "grant:write"],
        billingPermissions: ["billing:view"],
      });
    });

    it("should return null for revoked tokens", async () => {
      grantfoxTokenRepo.findOne.mockResolvedValue(null);

      const result = await service.resolveIdentity("revoked-token");

      expect(result).toBeNull();
    });
  });

  describe("getUserTokens", () => {
    it("should return tokens for a user", async () => {
      grantfoxTokenRepo.find.mockResolvedValue([
        {
          id: "token-1",
          grantfoxUserId: "gf-1",
          grantfoxOrgName: "Test Org",
          entitlements: ["read"],
          billingPermissions: ["view"],
          accessTokenExpiresAt: new Date(),
          refreshTokenExpiresAt: new Date(),
          createdAt: new Date(),
        },
      ] as any);

      const tokens = await service.getUserTokens("user-123");

      expect(tokens).toHaveLength(1);
      expect(tokens[0].grantfoxUserId).toBe("gf-1");
      expect(tokens[0].grantfoxOrgName).toBe("Test Org");
    });

    it("should return empty array when no tokens exist", async () => {
      grantfoxTokenRepo.find.mockResolvedValue([]);

      const tokens = await service.getUserTokens("user-123");

      expect(tokens).toHaveLength(0);
    });
  });

  describe("revokeToken", () => {
    it("should revoke a specific token", async () => {
      const mockToken = {
        id: "token-1",
        userId: "user-123",
        refreshToken: "refresh-abc",
        revoked: false,
        revokedAt: null as Date | null,
      };
      grantfoxTokenRepo.findOne.mockResolvedValue(mockToken as any);
      grantfoxTokenRepo.save.mockResolvedValue({} as any);

      // Mock fetch for revocation call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await service.revokeToken("user-123", "refresh-abc");

      expect(result.revoked).toBe(true);
      expect(result.count).toBe(1);
      expect(mockToken.revoked).toBe(true);
      expect(mockToken.revokedAt).toBeDefined();

      global.fetch = undefined as any;
    });

    it("should revoke all tokens when no specific token is provided", async () => {
      const mockTokens = [
        { id: "token-1", userId: "user-123", refreshToken: "r1", revoked: false },
        { id: "token-2", userId: "user-123", refreshToken: "r2", revoked: false },
      ];
      grantfoxTokenRepo.find.mockResolvedValue(mockTokens as any);
      grantfoxTokenRepo.save.mockResolvedValue({} as any);

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await service.revokeToken("user-123");

      expect(result.revoked).toBe(true);
      expect(result.count).toBe(2);
      expect(mockTokens[0].revoked).toBe(true);
      expect(mockTokens[1].revoked).toBe(true);

      global.fetch = undefined as any;
    });

    it("should throw when specific token is not found", async () => {
      grantfoxTokenRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revokeToken("user-123", "nonexistent"),
      ).rejects.toThrow("Token not found or already revoked");
    });
  });

  describe("handleCallback", () => {
    it("should throw for invalid state", async () => {
      grantfoxTokenRepo.findOne.mockResolvedValue(null);

      await expect(
        service.handleCallback("code", "invalid-state", "127.0.0.1"),
      ).rejects.toThrow("Invalid or expired OAuth state");
    });
  });
});
