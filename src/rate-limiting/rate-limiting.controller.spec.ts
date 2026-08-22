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
    it("returns aggregated metrics and entries", async () => {
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
    });

    it("calculates denial rate from allowed and denied totals", async () => {
      const { rateLimitAllowedTotal, rateLimitDeniedTotal } =
        await import("./rate-limiting.metrics");
      rateLimitAllowedTotal.inc(
        {
          tier: "free",
          scope: "global",
          strategy: "token-bucket",
          key: "global",
        },
        90,
      );
      rateLimitDeniedTotal.inc(
        {
          tier: "free",
          scope: "global",
          strategy: "token-bucket",
          key: "global",
        },
        10,
      );

      const result = await controller.getDashboard(makeReq());

      expect(result.totals.allowed).toBe(90);
      expect(result.totals.denied).toBe(10);
      expect(result.totals.rate).toBe(10);
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

    it("filters by tracker", async () => {
      const entries = [
        {
          key: "user:1:global:free",
          tracker: "user:1",
          scope: "global",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        },
        {
          key: "user:2:global:free",
          tracker: "user:2",
          scope: "global",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        },
      ];
      rateLimiter.listEntries = jest.fn().mockReturnValue(entries);

      const result = await controller.getStatus(makeReq(), "user:1");
      expect(result.count).toBe(1);
      expect(result.entries[0].tracker).toBe("user:1");
    });

    it("filters by scope", async () => {
      const entries = [
        {
          key: "user:1:/api/test:free",
          tracker: "user:1",
          scope: "/api/test",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        },
        {
          key: "user:1:/api/other:free",
          tracker: "user:1",
          scope: "/api/other",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        },
      ];
      rateLimiter.listEntries = jest.fn().mockReturnValue(entries);

      const result = await controller.getStatus(
        makeReq(undefined),
        undefined,
        "/api/test",
      );
      expect(result.count).toBe(1);
      expect(result.entries[0].scope).toBe("/api/test");
    });

    it("filters by tier", async () => {
      const entries = [
        {
          key: "user:1:g:free",
          tracker: "user:1",
          scope: "g",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        },
        {
          key: "user:1:g:paid",
          tracker: "user:1",
          scope: "g",
          tier: "paid",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        },
      ];
      rateLimiter.listEntries = jest.fn().mockReturnValue(entries);

      const result = await controller.getStatus(
        makeReq(undefined),
        undefined,
        undefined,
        "paid",
      );
      expect(result.count).toBe(1);
      expect(result.entries[0].tier).toBe("paid");
    });

    it("respects the limit parameter", async () => {
      const entries: any[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          key: `key:${i}`,
          tracker: `tracker:${i}`,
          scope: "global",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 100,
          windowMs: 60000,
          remaining: 50,
          resetAt: 0,
        });
      }
      rateLimiter.listEntries = jest.fn((limit?: number) =>
        entries.slice(0, limit ?? entries.length),
      );

      const result = await controller.getStatus(
        makeReq(undefined),
        undefined,
        undefined,
        undefined,
        "5",
      );
      expect(result.count).toBe(5);
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

    it("uses custom scope and tier when provided", async () => {
      const body = {
        key: "test-key",
        strategy: RateLimitStrategy.SlidingWindow,
        limit: 20,
        windowMs: 30_000,
        scope: "api",
        tier: "paid",
      };

      await controller.setEntry(makeReq(), body);

      expect(rateLimiter.consume).toHaveBeenCalledWith(
        "test-key:api:paid",
        expect.objectContaining({
          strategy: RateLimitStrategy.SlidingWindow,
        }),
        "key:test-key",
        "api",
        "paid",
      );
    });
  });

  describe("resetEntry", () => {
    it("calls reset with the composed key", async () => {
      await controller.resetEntry(makeReq(), "mykey", "global", "free");
      expect(rateLimiter.reset).toHaveBeenCalledWith("mykey:global:free");
    });

    it("defaults scope and tier when not provided", async () => {
      await controller.resetEntry(makeReq(), "mykey");
      expect(rateLimiter.reset).toHaveBeenCalledWith("mykey:global:free");
    });
  });

  describe("getStorageHealth", () => {
    it("returns the storage health from the service", async () => {
      const result = await controller.getStorageHealth(makeReq());
      expect(result).toBe("redis");
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

    it("accepts correct token via Authorization header", async () => {
      process.env.METRICS_AUTH_TOKEN = "secret123";
      await expect(
        controller.getDashboard(makeReq({ authorization: "Bearer secret123" })),
      ).resolves.toBeDefined();
    });

    it("accepts correct token via query param", async () => {
      process.env.METRICS_AUTH_TOKEN = "secret123";
      await expect(
        controller.getDashboard(makeReq({ token: "secret123" })),
      ).resolves.toBeDefined();
    });

    it("rejects wrong token", async () => {
      process.env.METRICS_AUTH_TOKEN = "secret123";
      await expect(
        controller.getDashboard(makeReq({ authorization: "Bearer wrong" })),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
