import { RateLimiterService, RateLimitConfig } from "./rate-limiter.service";
import { RateLimitStrategy, RateLimitViolation } from "./interfaces";

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
    hset: jest.fn(async () => 1),
    hdel: jest.fn(async () => 1),
    lpush: jest.fn(async () => 1),
    ltrim: jest.fn(async () => "OK"),
    lrange: jest.fn(async () => []),
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

    describe("whitelist and blacklist management", () => {
      it("adds and checks whitelisted IP and user", async () => {
        await service.addWhitelist({
          type: "ip",
          value: "192.168.1.100",
          reason: "internal",
        });
        await service.addWhitelist({
          type: "user",
          value: "admin-user",
          reason: "vip",
        });

        expect(await service.isWhitelisted("192.168.1.100")).toBe(true);
        expect(await service.isWhitelisted("10.0.0.1")).toBe(false);
        expect(await service.isWhitelisted(undefined, "admin-user")).toBe(true);
        expect(await service.isWhitelisted(undefined, "regular-user")).toBe(false);
      });

      it("supports wildcard IP and path patterns in whitelist", async () => {
        await service.addWhitelist({ type: "ip", value: "10.0.*" });
        await service.addWhitelist({ type: "path", value: "/health*" });

        expect(await service.isWhitelisted("10.0.1.5")).toBe(true);
        expect(await service.isWhitelisted("192.168.1.1")).toBe(false);
        expect(await service.isWhitelisted(undefined, undefined, undefined, "/health/ready")).toBe(true);
      });

      it("removes from whitelist", async () => {
        await service.addWhitelist({ type: "ip", value: "127.0.0.1" });
        expect(await service.isWhitelisted("127.0.0.1")).toBe(true);

        await service.removeWhitelist("127.0.0.1");
        expect(await service.isWhitelisted("127.0.0.1")).toBe(false);
      });

      it("adds and checks blacklisted IP and user", async () => {
        await service.addBlacklist({
          type: "ip",
          value: "198.51.100.23",
          reason: "ddos attacker",
        });

        expect(await service.isBlacklisted("198.51.100.23")).toBe(true);
        expect(await service.isBlacklisted("8.8.8.8")).toBe(false);

        await service.removeBlacklist("198.51.100.23");
        expect(await service.isBlacklisted("198.51.100.23")).toBe(false);
      });
    });

    describe("violations and analytics", () => {
      it("records violations and computes analytics", async () => {
        await service.recordViolation({
          ip: "1.2.3.4",
          tracker: "ip:1.2.3.4",
          route: "/api/v1/auth/login",
          method: "POST",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 5,
          reason: "rate_limit_exceeded",
        });

        await service.recordViolation({
          ip: "1.2.3.4",
          tracker: "ip:1.2.3.4",
          route: "/api/v1/auth/login",
          method: "POST",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 5,
          reason: "rate_limit_exceeded",
        });

        const violations = await service.getViolations();
        expect(violations.length).toBe(2);
        expect(violations[0].ip).toBe("1.2.3.4");

        const analytics = await service.getAnalytics();
        expect(analytics.totalViolations).toBe(2);
        expect(analytics.uniqueViolators).toBe(1);
        expect(analytics.topViolators[0].tracker).toBe("ip:1.2.3.4");
        expect(analytics.topRoutes[0].route).toBe("/api/v1/auth/login");
      });

      it("assigns every violation a CSPRNG-backed id", async () => {
        // Annotated rather than left to inference: `reason` is a string
        // literal union on RateLimitViolation, and widening it to `string` by
        // extracting the literal into a variable makes it unassignable.
        const violation: Omit<RateLimitViolation, "id" | "timestamp"> = {
          ip: "1.2.3.4",
          tracker: "ip:1.2.3.4",
          route: "/api/v1/auth/login",
          method: "POST",
          tier: "free",
          strategy: RateLimitStrategy.TokenBucket,
          limit: 5,
          reason: "rate_limit_exceeded",
        };

        const ids = new Set<string>();
        for (let i = 0; i < 5_000; i++) {
          const { id } = await service.recordViolation(violation);
          // Ids are externally visible on the rate-limiting API: keep the
          // existing `<epochMillis>-<suffix>` shape, but the suffix must now be
          // a v4 UUID rather than a `Math.random()` base-36 fragment.
          expect(id).toMatch(
            /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          ids.add(id);
        }

        expect(ids.size).toBe(5_000);
      });
    });

    describe("endpoint rule configuration", () => {
      it("stores and resolves custom endpoint rules", () => {
        service.addEndpointRule({
          pathPattern: "/api/v1/heavy*",
          method: "POST",
          limit: 5,
          windowMs: 60000,
          strategy: RateLimitStrategy.SlidingWindow,
        });

        const rule = service.getEndpointRule("/api/v1/heavy-computation", "POST");
        expect(rule).toBeDefined();
        expect(rule?.limit).toBe(5);
        expect(rule?.strategy).toBe(RateLimitStrategy.SlidingWindow);

        const noMatch = service.getEndpointRule("/api/v1/heavy-computation", "GET");
        expect(noMatch).toBeUndefined();
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

    it("passes a unique CSPRNG member per sliding-window request", async () => {
      const policy = {
        limit: 5,
        windowMs: 60_000,
        burst: 5,
        strategy: RateLimitStrategy.SlidingWindow,
      };

      for (let i = 0; i < 2_000; i++) {
        await service.consume("redis-sw-unique:g:f", policy, null, "global", "f");
      }

      // The 5th ARGV is the sorted-set member. A colliding member would let one
      // request evict or double-count another client's window entry.
      const members = mockRedis.eval.mock.calls.map(
        (call: unknown[]) => call[5] as string,
      );
      expect(members.length).toBe(2_000);
      expect(new Set(members).size).toBe(2_000);
      for (const member of members) {
        expect(member).toMatch(
          /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
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

      const memWindows = (service as any).memoryWindows;
      expect(memWindows.has("alian:rl:default-strategy:g:f")).toBe(true);
    });
  });
});
