import { Test, TestingModule } from "@nestjs/testing";
import { GrantfoxController } from "./grantfox.controller";
import { GrantfoxOAuthService } from "./services/grantfox-oauth.service";

describe("GrantfoxController", () => {
  let controller: GrantfoxController;
  let service: GrantfoxOAuthService;

  const mockGrantfoxOAuthService = {
    startAuthorization: jest.fn(),
    handleCallback: jest.fn(),
    refreshToken: jest.fn(),
    revokeToken: jest.fn(),
    getUserTokens: jest.fn(),
    resolveIdentity: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrantfoxController],
      providers: [
        {
          provide: GrantfoxOAuthService,
          useValue: mockGrantfoxOAuthService,
        },
      ],
    }).compile();

    controller = module.get<GrantfoxController>(GrantfoxController);
    service = module.get<GrantfoxOAuthService>(GrantfoxOAuthService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("POST /auth/grantfox/start", () => {
    it("should return authorization URL and state", async () => {
      const mockResult = {
        authorizationUrl: "https://auth.grantfox.io/oauth/authorize?...",
        state: "mock-state-uuid",
      };
      mockGrantfoxOAuthService.startAuthorization.mockResolvedValue(
        mockResult,
      );

      const result = await controller.startAuthorization({
        scopes: ["openid", "profile"],
      });

      expect(result).toEqual(mockResult);
      expect(service.startAuthorization).toHaveBeenCalledWith([
        "openid",
        "profile",
      ]);
    });

    it("should use default scopes when none provided", async () => {
      mockGrantfoxOAuthService.startAuthorization.mockResolvedValue({
        authorizationUrl: "...",
        state: "...",
      });

      await controller.startAuthorization({});

      expect(service.startAuthorization).toHaveBeenCalledWith(undefined);
    });
  });

  describe("POST /auth/grantfox/callback", () => {
    it("should handle callback and return auth result", async () => {
      const mockResult = {
        accessToken: "gf-access-token",
        refreshToken: "gf-refresh-token",
        user: {
          id: "user-123",
          email: "test@example.com",
          username: "testuser",
          role: "user",
          tier: "free",
        },
        entitlements: ["grant:read"],
        billingPermissions: ["billing:view"],
      };
      mockGrantfoxOAuthService.handleCallback.mockResolvedValue(mockResult);

      const req = {
        ip: "127.0.0.1",
        headers: { "user-agent": "test-agent" },
      };

      const result = await controller.handleCallback(
        { code: "auth-code", state: "state-value" },
        req,
      );

      expect(result).toEqual(mockResult);
      expect(service.handleCallback).toHaveBeenCalledWith(
        "auth-code",
        "state-value",
        "127.0.0.1",
        "test-agent",
      );
    });
  });

  describe("POST /auth/grantfox/refresh", () => {
    it("should refresh tokens", async () => {
      const mockResult = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      };
      mockGrantfoxOAuthService.refreshToken.mockResolvedValue(mockResult);

      const req = {
        user: { sub: "user-123" },
        ip: "127.0.0.1",
      };

      const result = await controller.refreshToken(
        { refreshToken: "old-refresh-token" },
        req,
      );

      expect(result).toEqual(mockResult);
      expect(service.refreshToken).toHaveBeenCalledWith(
        "old-refresh-token",
        "127.0.0.1",
      );
    });
  });

  describe("POST /auth/grantfox/revoke", () => {
    it("should revoke a specific token", async () => {
      const mockResult = { revoked: true, count: 1 };
      mockGrantfoxOAuthService.revokeToken.mockResolvedValue(mockResult);

      const req = {
        user: { sub: "user-123" },
      };

      const result = await controller.revokeToken(
        { refreshToken: "token-to-revoke" },
        req,
      );

      expect(result).toEqual(mockResult);
      expect(service.revokeToken).toHaveBeenCalledWith(
        "user-123",
        "token-to-revoke",
      );
    });

    it("should revoke all tokens when no specific token is provided", async () => {
      const mockResult = { revoked: true, count: 3 };
      mockGrantfoxOAuthService.revokeToken.mockResolvedValue(mockResult);

      const req = {
        user: { sub: "user-123" },
      };

      const result = await controller.revokeToken({}, req);

      expect(result).toEqual(mockResult);
      expect(service.revokeToken).toHaveBeenCalledWith("user-123", undefined);
    });
  });

  describe("GET /auth/grantfox/status", () => {
    it("should return connected status with tokens", async () => {
      const mockTokens = [
        {
          id: "token-1",
          grantfoxUserId: "gf-123",
          grantfoxOrgName: "Test Org",
          entitlements: ["read"],
          billingPermissions: ["view"],
          accessTokenExpiresAt: new Date(),
          refreshTokenExpiresAt: new Date(),
          createdAt: new Date(),
        },
      ];
      mockGrantfoxOAuthService.getUserTokens.mockResolvedValue(mockTokens);

      const req = {
        user: { sub: "user-123" },
      };

      const result = await controller.getStatus(req);

      expect(result).toEqual({
        connected: true,
        tokens: mockTokens,
      });
    });

    it("should return disconnected status when no tokens exist", async () => {
      mockGrantfoxOAuthService.getUserTokens.mockResolvedValue([]);

      const req = {
        user: { sub: "user-123" },
      };

      const result = await controller.getStatus(req);

      expect(result).toEqual({
        connected: false,
        tokens: [],
      });
    });
  });
});
