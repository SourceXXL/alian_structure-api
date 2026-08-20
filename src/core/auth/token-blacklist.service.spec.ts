import { Test, TestingModule } from "@nestjs/testing";
import { TokenBlacklistService } from "./token-blacklist.service";

describe("TokenBlacklistService", () => {
  let service: TokenBlacklistService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TokenBlacklistService],
    }).compile();
    service = module.get<TokenBlacklistService>(TokenBlacklistService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("revoke", () => {
    it("should revoke a token by jti", () => {
      const futureMs = Date.now() + 3600000;
      service.revoke("jti-1", futureMs);
      expect(service.isRevoked("jti-1")).toBe(true);
    });
  });

  describe("isRevoked", () => {
    it("should return false for an unknown jti", () => {
      expect(service.isRevoked("unknown-jti")).toBe(false);
    });

    it("should return true for a revoked jti", () => {
      service.revoke("jti-2", Date.now() + 3600000);
      expect(service.isRevoked("jti-2")).toBe(true);
    });

    it("should return false for an expired revoke entry", () => {
      service.revoke("jti-expired", Date.now() - 1000);
      expect(service.isRevoked("jti-expired")).toBe(false);
    });
  });
});
