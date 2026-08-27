import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { RateLimitingController } from "./rate-limiting.controller";
import { RateLimiterService } from "./rate-limiter.service";
import { RateLimitStorage, RateLimitStrategy } from "./interfaces";

function makeMockRateLimiter() {
  const mock = {
    getStorageHealth: jest.fn().mockResolvedValue("redis" as RateLimitStorage),
    listEntries: jest.fn().mockReturnValue([]),
    consume: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    }),
    reset: jest.fn().mockResolvedValue(true),
    listWhitelist: jest.fn().mockResolvedValue([]),
    addWhitelist: jest.fn().mockResolvedValue({
      id: "ip:127.0.0.1",
      type: "ip",
      value: "127.0.0.1",
      createdAt: Date.now(),
    }),
    removeWhitelist: jest.fn().mockResolvedValue(true),
    listBlacklist: jest.fn().mockResolvedValue([]),
    addBlacklist: jest.fn().mockResolvedValue({
      id: "ip:10.0.0.1",
      type: "ip",
      value: "10.0.0.1",
      createdAt: Date.now(),
    }),
    removeBlacklist: jest.fn().mockResolvedValue(true),
    getViolations: jest.fn().mockResolvedValue([]),
    getAnalytics: jest.fn().mockResolvedValue({
      timestamp: new Date().toISOString(),
      totalViolations: 0,
      uniqueViolators: 0,
      topViolators: [],
      topRoutes: [],
      violationsByTier: {},
      violationsByStrategy: {},
      timeSeries: [],
    }),
    addEndpointRule: jest.fn(),
  };
  return mock as unknown as RateLimiterService;
}

function makeReq(opts: { authorization?: string; token?: string } = {}): any {
  return {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    query: opts.token ? { token: opts.token } : {},
  };
}

describe("RateLimitingController", () => {
  let controller: RateLimitingController;
  let rateLimiter: ReturnType<typeof makeMockRateLimiter>;

  beforeEach(async () => {
    rateLimiter = makeMockRateLimiter();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RateLimitingController],
      providers: [{ provide: RateLimiterService, useValue: rateLimiter }],
    }).compile();

    controller = module.get<RateLimitingController>(RateLimitingController);
  });

  describe("getDashboard", () => {
    it("returns aggregated metrics, whitelist/blacklist stats, and entries", async () => {
      rateLimiter.listEntries = jest.fn().mockReturnValue([
        {
          key: "user:1:/api/test:free",
          tracker: "user:1",
          scope: "/api/test",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60_000,
          remaining: 50,
          resetAt: Date.now() + 30_000,
        },
      ]);

      const result = await controller.getDashboard(makeReq());

      expect(result.storage).toBe("redis");
      expect(result.totals).toHaveProperty("allowed");
      expect(result.totals).toHaveProperty("denied");
      expect(result.totals).toHaveProperty("errors");
      expect(result.totals).toHaveProperty("rate");
      expect(result.activeEntries).toBe(1);
      expect(result.topEntries).toHaveLength(1);
      expect(result.strategyDistribution).toHaveProperty("token-bucket");
      expect(result).toHaveProperty("whitelistCount");
      expect(result).toHaveProperty("blacklistCount");
    });
  });

  describe("getStatus", () => {
    it("returns all entries by default", async () => {
      rateLimiter.listEntries = jest.fn().mockReturnValue([
        {
          key: "user:1:global:free",
          tracker: "user:1",
          scope: "global",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60_000,
          remaining: 50,
          resetAt: Date.now() + 30_000,
        },
      ]);

      const result = await controller.getStatus(makeReq());
      expect(result.count).toBe(1);
      expect(result.entries).toHaveLength(1);
    });
  });

  describe("whitelist endpoints", () => {
    it("lists whitelist", async () => {
      const result = await controller.getWhitelist(makeReq());
      expect(result.count).toBe(0);
      expect(rateLimiter.listWhitelist).toHaveBeenCalled();
    });

    it("adds to whitelist", async () => {
      const result = await controller.addWhitelist(makeReq(), {
        type: "ip",
        value: "127.0.0.1",
      });
      expect(result.message).toBe("Added to whitelist");
      expect(rateLimiter.addWhitelist).toHaveBeenCalled();
    });

    it("removes from whitelist", async () => {
      const result = await controller.removeWhitelist(makeReq(), "127.0.0.1");
      expect(result.removed).toBe(true);
      expect(rateLimiter.removeWhitelist).toHaveBeenCalledWith("127.0.0.1");
    });
  });

  describe("blacklist endpoints", () => {
    it("lists blacklist", async () => {
      const result = await controller.getBlacklist(makeReq());
      expect(result.count).toBe(0);
      expect(rateLimiter.listBlacklist).toHaveBeenCalled();
    });

    it("adds to blacklist", async () => {
      const result = await controller.addBlacklist(makeReq(), {
        type: "ip",
        value: "10.0.0.1",
      });
      expect(result.message).toBe("Added to blacklist");
      expect(rateLimiter.addBlacklist).toHaveBeenCalled();
    });

    it("removes from blacklist", async () => {
      const result = await controller.removeBlacklist(makeReq(), "10.0.0.1");
      expect(result.removed).toBe(true);
      expect(rateLimiter.removeBlacklist).toHaveBeenCalledWith("10.0.0.1");
    });
  });

  describe("violations and analytics endpoints", () => {
    it("returns violation logs", async () => {
      const result = await controller.getViolations(makeReq());
      expect(result).toHaveProperty("violations");
      expect(rateLimiter.getViolations).toHaveBeenCalled();
    });

    it("returns analytics", async () => {
      const result = await controller.getAnalytics(makeReq(), "3600000");
      expect(result).toHaveProperty("totalViolations");
      expect(rateLimiter.getAnalytics).toHaveBeenCalledWith(3600000);
    });

    it("adds endpoint rule", async () => {
      const result = await controller.addEndpointRule(makeReq(), {
        pathPattern: "/api/v1/auth/*",
        limit: 5,
        windowMs: 60000,
      });
      expect(result.message).toBe("Endpoint rule configured");
      expect(rateLimiter.addEndpointRule).toHaveBeenCalled();
    });
  });

  describe("getMetrics", () => {
    it("returns Prometheus text exposition", async () => {
      const result = await controller.getMetrics(makeReq());
      expect(typeof result).toBe("string");
      expect(result).toContain("alian_structure_rate_limit");
    });
  });

  describe("setEntry", () => {
    it("calls consume with the provided config", async () => {
      const body = {
        key: "test-key",
        strategy: RateLimitStrategy.TokenBucket,
        limit: 10,
        windowMs: 60_000,
      };

      await controller.setEntry(makeReq(), body);

      expect(rateLimiter.consume).toHaveBeenCalledWith(
        "test-key:global:free",
        expect.objectContaining({
          limit: 10,
          windowMs: 60_000,
          strategy: RateLimitStrategy.TokenBucket,
        }),
        "key:test-key",
        "global",
        "free",
      );
    });
  });

  describe("resetEntry", () => {
    it("calls reset with the composed key", async () => {
      await controller.resetEntry(makeReq(), "mykey", "global", "free");
      expect(rateLimiter.reset).toHaveBeenCalledWith("mykey:global:free");
    });
  });

  describe("authorization", () => {
    const ORIGINAL = process.env.METRICS_AUTH_TOKEN;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.METRICS_AUTH_TOKEN;
      } else {
        process.env.METRICS_AUTH_TOKEN = ORIGINAL;
      }
    });

    it("allows access when no token is configured", async () => {
      delete process.env.METRICS_AUTH_TOKEN;
      await expect(controller.getDashboard(makeReq())).resolves.toBeDefined();
    });

    it("rejects when token is configured but not provided", async () => {
      process.env.METRICS_AUTH_TOKEN = "secret123";
      await expect(controller.getDashboard(makeReq())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
