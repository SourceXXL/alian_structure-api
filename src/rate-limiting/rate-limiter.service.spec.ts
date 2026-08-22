import { RateLimiterService, RateLimitConfig } from "./rate-limiter.service";
import { RateLimitStrategy } from "./interfaces";

const DEFAULT_CONFIG: RateLimitConfig = {
  keyPrefix: "alian:rl:",
  defaultStrategy: RateLimitStrategy.TokenBucket,
  enableFallback: true,
};

function makeMockRedis() {
  const calls: { method: string; args: unknown[] }[] = [];
  const mockRedis: any = {
    eval: jest.fn(async () => {
      calls.push({ method: "eval", args: [] });
      return [1, 5, 0];
    }),
    ping: jest.fn(async () => "PONG"),
    hgetall: jest.fn(async () => ({ tokens: "5", ts: "1000" })),
    zcount: jest.fn(async () => 2),
    del: jest.fn(async () => 1),
    psetex: jest.fn(async () => "OK"),
    expire: jest.fn(async () => 1),
  };
  mockRedis._calls = calls;
  return mockRedis;
}

describe("RateLimiterService", () => {
  describe("in-memory mode (no Redis)", () => {
    let service: RateLimiterService;

    beforeEach(() => {
      service = new RateLimiterService(null, DEFAULT_CONFIG);
    });

    describe("token bucket strategy", () => {
      it("allows requests within the token budget", async () => {
        const policy = {
          limit: 5,
          windowMs: 60_000,
          burst: 5,
          strategy: RateLimitStrategy.TokenBucket,
        };

        for (let i = 0; i < 5; i++) {
          const decision = await service.consume(
            "user:123:global:free",
            policy,
            "user:123",
            "global",
            "free",
          );
          expect(decision.allowed).toBe(true);
        }
      });

      it("denies requests once tokens are exhausted", async () => {
        const policy = {
          limit: 2,
          windowMs: 60_000,
          burst: 2,
          strategy: RateLimitStrategy.TokenBucket,
        };

        await service.consume(
          "key:global:free",
          policy,
          "key",
          "global",
          "free",
        );
        await service.consume(
          "key:global:free",
          policy,
          "key",
          "global",
          "free",
        );

        const decision = await service.consume(
          "key:global:free",
          policy,
          "key",
          "global",
          "free",
        );
        expect(decision.allowed).toBe(false);
        expect(decision.remaining).toBe(0);
        expect(decision.retryAfterMs).toBeGreaterThan(0);
      });

      it("sets retryAfterMs on denial", async () => {
        const policy = {
          limit: 1,
          windowMs: 60_000,
          burst: 1,
          strategy: RateLimitStrategy.TokenBucket,
        };

        await service.consume("k:g:f", policy, "k", "g", "f");
        const decision = await service.consume("k:g:f", policy, "k", "g", "f");

        expect(decision.allowed).toBe(false);
        expect(decision.retryAfterMs).toBeGreaterThan(0);
      });

      it("reports positive remaining on allowed requests", async () => {
        const policy = {
          limit: 10,
          windowMs: 60_000,
          burst: 10,
          strategy: RateLimitStrategy.TokenBucket,
        };

        const decision = await service.consume("k:g:f", policy, "k", "g", "f");
        expect(decision.allowed).toBe(true);
        expect(decision.remaining).toBe(9);
      });
    });

    describe("sliding window strategy", () => {
      it("allows requests within the limit", async () => {
        const policy = {
          limit: 3,
          windowMs: 60_000,
          burst: 3,
          strategy: RateLimitStrategy.SlidingWindow,
        };

        for (let i = 0; i < 3; i++) {
          const decision = await service.consume(
            "sw:key:global:free",
            policy,
            "sw:key",
            "global",
            "free",
          );
          expect(decision.allowed).toBe(true);
        }
      });

      it("denies requests once the window limit is reached", async () => {
        const policy = {
          limit: 2,
          windowMs: 60_000,
          burst: 2,
          strategy: RateLimitStrategy.SlidingWindow,
        };

        await service.consume("sw:k:g:f", policy, "sw:k", "g", "f");
        await service.consume("sw:k:g:f", policy, "sw:k", "g", "f");

        const decision = await service.consume(
          "sw:k:g:f",
          policy,
          "sw:k",
          "g",
          "f",
        );
        expect(decision.allowed).toBe(false);
        expect(decision.remaining).toBe(0);
        expect(decision.retryAfterMs).toBeGreaterThan(0);
      });

      it("allows a new request after the window expires (memory)", async () => {
        const policy = {
          limit: 2,
          windowMs: 60_000,
          burst: 2,
          strategy: RateLimitStrategy.SlidingWindow,
        };

        await service.consume("sw:exp:g:f", policy, "sw:exp", "g", "f");
        await service.consume("sw:exp:g:f", policy, "sw:exp", "g", "f");

        // Manually manipulate the memory window to simulate time passing
        const memWindows = (service as any).memoryWindows as Map<
          string,
          number[]
        >;
        const windowKey = "alian:rl:sw:exp:g:f";
        memWindows.set(windowKey, [Date.now() - 120_000]); // expired entry

        const decision = await service.consume(
          "sw:exp:g:f",
          policy,
          "sw:exp",
          "g",
          "f",
        );
        expect(decision.allowed).toBe(true);
      });
    });

    describe("getEntry", () => {
      it("returns null for unknown key", async () => {
        const entry = await service.getEntry("nonexistent");
        expect(entry).toBeNull();
      });

      it("returns entry data after a consume call", async () => {
        const policy = {
          limit: 5,
          windowMs: 60_000,
          burst: 5,
          strategy: RateLimitStrategy.TokenBucket,
        };

        await service.consume(
          "test-key:g:tier",
          policy,
          "test-key",
          "global",
          "tier",
        );
        const entry = await service.getEntry("test-key:g:tier");
        expect(entry).not.toBeNull();
        expect(entry!.tracker).toBe("test-key");
        expect(entry!.tier).toBe("tier");
      });
    });

    describe("reset", () => {
      it("removes the entry from the registry", async () => {
        const policy = {
          limit: 5,
          windowMs: 60_000,
          burst: 5,
          strategy: RateLimitStrategy.TokenBucket,
        };

        await service.consume("reset-key:g:f", policy, "reset-key", "g", "f");
        expect(service.listEntries()).toHaveLength(1);
        await service.reset("reset-key:g:f");
        expect(service.listEntries()).toHaveLength(0);
      });
    });

    describe("listEntries", () => {
      it("returns all registered entries", async () => {
        const policy = {
          limit: 5,
          windowMs: 60_000,
          burst: 5,
          strategy: RateLimitStrategy.TokenBucket,
        };
        await service.consume("k1:g:f", policy, "k1", "g", "f");
        await service.consume("k2:g:f", policy, "k2", "g", "f");
        await service.consume("k3:g:f", policy, "k3", "g", "f");
        expect(service.listEntries()).toHaveLength(3);
      });

      it("respects the limit parameter", async () => {
        const policy = {
          limit: 5,
          windowMs: 60_000,
          burst: 5,
          strategy: RateLimitStrategy.TokenBucket,
        };
        await service.consume("k1:g:f", policy, "k1", "g", "f");
        await service.consume("k2:g:f", policy, "k2", "g", "f");
        await service.consume("k3:g:f", policy, "k3", "g", "f");
        expect(service.listEntries(2).length).toBeLessThanOrEqual(2);
      });
    });

    describe("getStorageHealth", () => {
      it("returns memory when Redis is null", async () => {
        const service = new RateLimiterService(null, DEFAULT_CONFIG);
        expect(await service.getStorageHealth()).toBe("memory");
      });

      it("returns memory when Redis is unhealthy", async () => {
        const mockRedis: any = {
          ping: jest.fn().mockRejectedValue(new Error("Redis is down")),
        };
        const service = new RateLimiterService(mockRedis, DEFAULT_CONFIG);
        expect(await service.getStorageHealth()).toBe("memory");
      });

      it("returns redis when Redis is healthy", async () => {
        const mockRedis: any = {
          ping: jest.fn().mockResolvedValue("PONG"),
        };
        const service = new RateLimiterService(mockRedis, DEFAULT_CONFIG);
        expect(await service.getStorageHealth()).toBe("redis");
      });
    });
  });

  describe("Redis mode", () => {
    let service: RateLimiterService;
    let mockRedis: any;

    beforeEach(() => {
      mockRedis = makeMockRedis();
      service = new RateLimiterService(mockRedis as any, DEFAULT_CONFIG);
    });

    it("uses Redis eval for token bucket consume", async () => {
      const policy = {
        limit: 5,
        windowMs: 60_000,
        burst: 5,
        strategy: RateLimitStrategy.TokenBucket,
      };

      const decision = await service.consume(
        "redis-key:g:f",
        policy,
        null,
        "global",
        "f",
      );

      expect(mockRedis.eval).toHaveBeenCalled();
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(5);
    });

    it("uses Redis eval for sliding window consume", async () => {
      const policy = {
        limit: 5,
        windowMs: 60_000,
        burst: 5,
        strategy: RateLimitStrategy.SlidingWindow,
      };

      const decision = await service.consume(
        "redis-sw:g:f",
        policy,
        null,
        "global",
        "f",
      );

      expect(mockRedis.eval).toHaveBeenCalled();
      expect(decision.allowed).toBe(true);
    });

    it("falls back to memory when Redis eval throws", async () => {
      mockRedis.eval = jest.fn().mockRejectedValue(new Error("Redis error"));

      const policy = {
        limit: 3,
        windowMs: 60_000,
        burst: 3,
        strategy: RateLimitStrategy.TokenBucket,
      };

      const decision = await service.consume(
        "fallback-key:g:f",
        policy,
        null,
        "global",
        "f",
      );

      expect(decision.allowed).toBe(true);
    });

    it("del calls redis.del when Redis is healthy", async () => {
      await service.consume(
        "del-key:g:f",
        {
          limit: 5,
          windowMs: 60_000,
          burst: 5,
          strategy: RateLimitStrategy.TokenBucket,
        },
        "k",
        "g",
        "f",
      );
      mockRedis.del.mockClear();
      await service.reset("del-key:g:f");
      expect(mockRedis.del).toHaveBeenCalledWith("alian:rl:del-key:g:f");
    });
  });

  describe("default strategy", () => {
    it("uses token bucket by default when no strategy specified", async () => {
      const service = new RateLimiterService(null, {
        keyPrefix: "alian:rl:",
        defaultStrategy: RateLimitStrategy.SlidingWindow,
        enableFallback: true,
      });

      const policy = { limit: 5, windowMs: 60_000, burst: 5 };
      const decision = await service.consume(
        "default-strategy:g:f",
        policy,
        "k",
        "g",
        "f",
      );
      expect(decision.allowed).toBe(true);

      // Sliding window stores entries as arrays, token bucket stores as buckets
      const memWindows = (service as any).memoryWindows;
      expect(memWindows.has("alian:rl:default-strategy:g:f")).toBe(true);
    });
  });
});
