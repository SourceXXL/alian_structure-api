import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { CacheKeyGenerator } from "./cache-key.generator";
import { CacheService } from "./cache.service";
import { CacheStatsService } from "./cache-stats.service";
import { CacheWarmingService } from "./cache-warming.service";
import {
  CacheInvalidationService,
  InvalidationStrategyType,
} from "./cache-invalidation.service";
import { Cacheable, CacheInvalidate } from "./cacheable.decorator";
import { CacheTag } from "./cache-invalidation.service";

// ---------------------------------------------------------------------------
// Mock ConfigService
// ---------------------------------------------------------------------------

function makeConfigService(
  overrides: Record<string, string> = {},
): ConfigService {
  return {
    get: (key: string) => overrides[key],
  } as any;
}

// ---------------------------------------------------------------------------
// CacheKeyGenerator
// ---------------------------------------------------------------------------

describe("CacheKeyGenerator", () => {
  let gen: CacheKeyGenerator;

  beforeEach(() => {
    gen = new CacheKeyGenerator("test:", "v1", 16);
  });

  it("generates a key with prefix, version, namespace, and hash", () => {
    const key = gen.generate("user", 42);
    expect(key).toMatch(/^test:v1:user:[a-f0-9]{16}$/);
  });

  it("produces the same key for identical arguments", () => {
    const k1 = gen.generate("user", 42, "alice");
    const k2 = gen.generate("user", 42, "alice");
    expect(k1).toBe(k2);
  });

  it("produces different keys for different arguments", () => {
    const k1 = gen.generate("user", 42);
    const k2 = gen.generate("user", 43);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different namespaces", () => {
    const k1 = gen.generate("user", 42);
    const k2 = gen.generate("portfolio", 42);
    expect(k1).not.toBe(k2);
  });

  it("handles complex objects deterministically (key order independent)", () => {
    const k1 = gen.generate("data", { b: 2, a: 1 });
    const k2 = gen.generate("data", { a: 1, b: 2 });
    expect(k1).toBe(k2);
  });

  it("handles Date arguments", () => {
    const date = new Date("2025-01-01T00:00:00Z");
    const k1 = gen.generate("events", date);
    const k2 = gen.generate("events", new Date("2025-01-01T00:00:00Z"));
    expect(k1).toBe(k2);
  });

  it("handles BigInt arguments", () => {
    const key = gen.generate("value", BigInt(42));
    expect(key).toContain("value");
  });

  it("namespacePrefix returns the correct pattern", () => {
    expect(gen.namespacePrefix("user")).toBe("test:v1:user:*");
  });

  it("stripVersion removes the version segment", () => {
    const key = "test:v1:user:abc123";
    expect(gen.stripVersion(key)).toBe("test:user:abc123");
  });
});

// ---------------------------------------------------------------------------
// CacheService (in-memory fallback)
// ---------------------------------------------------------------------------

describe("CacheService", () => {
  let service: CacheService;

  beforeEach(async () => {
    // No Redis — tests exercise the in-memory fallback path
    service = new CacheService(null, makeConfigService({ CACHE_VERSION: "v1" }));
  });

  describe("get / set / del", () => {
    it("returns null for a cache miss", async () => {
      const result = await service.get("user", 42);
      expect(result).toBeNull();
    });

    it("stores and retrieves a value", async () => {
      await service.set("user", { name: "Alice" }, [42], 60);
      const result = await service.get("user", 42);
      expect(result).toEqual({ name: "Alice" });
    });

    it("handles string values", async () => {
      await service.set("token", "abc123", []);
      const result = await service.get("token");
      expect(result).toBe("abc123");
    });

    it("handles null values", async () => {
      await service.set("empty", null, []);
      const result = await service.get("empty");
      expect(result).toBeNull();
    });

    it("deletes a cached entry", async () => {
      await service.set("user", { name: "Bob" }, [7], 60);
      await service.del("user", 7);
      const result = await service.get("user", 7);
      expect(result).toBeNull();
    });
  });

  describe("TTL", () => {
    it("expires entries after TTL", async () => {
      await service.set("temp", "data", [], 0.01); // 10ms TTL
      await new Promise((r) => setTimeout(r, 50));
      const result = await service.get("temp");
      expect(result).toBeNull();
    });

    it("returns -1 for non-existent keys", async () => {
      const ttl = await service.ttl("nonexistent");
      expect(ttl).toBe(-1);
    });
  });

  describe("has", () => {
    it("returns false for missing keys", async () => {
      expect(await service.has("x")).toBe(false);
    });

    it("returns true for present keys", async () => {
      await service.set("x", "val", [], 60);
      expect(await service.has("x")).toBe(true);
    });

    it("returns false for expired keys", async () => {
      await service.set("x", "val", [], 0.01);
      await new Promise((r) => setTimeout(r, 50));
      expect(await service.has("x")).toBe(false);
    });
  });

  describe("getMany", () => {
    it("returns multiple values", async () => {
      await service.set("item", "a", [1], 60);
      await service.set("item", "b", [2], 60);
      const results = await service.getMany("item", [[1], [2], [3]]);
      expect(results).toEqual(["a", "b", null]);
    });
  });

  describe("delPattern", () => {
    it("deletes entries matching a glob pattern", async () => {
      await service.set("user:1", "a", ["profile"], 60);
      await service.set("user:2", "b", ["profile"], 60);
      await service.set("portfolio:1", "c", ["data"], 60);

      // Use namespacePrefix to get the pattern
      const pattern = service.keys.namespacePrefix("user:1");
      // pattern = "test:v1:user:1:*" — only matches user:1

      const deleted = await service.delPattern(pattern);
      expect(deleted).toBe(1);

      expect(await service.has("user:1", "profile")).toBe(false);
      // user:2 and portfolio:1 should survive
      expect(await service.has("user:2", "profile")).toBe(true);
      expect(await service.has("portfolio:1", "data")).toBe(true);
    });
  });

  describe("invalidatePrefix", () => {
    it("invalidates all entries under a namespace", async () => {
      await service.set("user", { id: 1 }, [1], 60);
      await service.set("user", { id: 2 }, [2], 60);
      await service.set("portfolio", { id: 1 }, [1], 60);

      const deleted = await service.invalidatePrefix("user");
      expect(deleted).toBe(2);

      expect(await service.get("user", 1)).toBeNull();
      expect(await service.get("user", 2)).toBeNull();
      expect(await service.get("portfolio", 1)).not.toBeNull();
    });
  });

  describe("clear", () => {
    it("wipes the entire memory cache", async () => {
      await service.set("a", 1, [], 60);
      await service.set("b", 2, [], 60);
      await service.clear();
      expect(await service.has("a")).toBe(false);
      expect(await service.has("b")).toBe(false);
    });
  });

  describe("isRedisConnected", () => {
    it("returns false when no Redis client", async () => {
      expect(await service.isRedisConnected()).toBe(false);
    });
  });

  describe("stampede prevention", () => {
    it("singleflight collapses concurrent calls", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return "result";
      };

      const [r1, r2, r3] = await Promise.all([
        service.singleflight("key1", fn),
        service.singleflight("key1", fn),
        service.singleflight("key1", fn),
      ]);

      expect(r1).toBe("result");
      expect(r2).toBe("result");
      expect(r3).toBe("result");
      expect(callCount).toBe(1);
    });

    it("different keys execute independently", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return "result";
      };

      await Promise.all([
        service.singleflight("key-a", fn),
        service.singleflight("key-b", fn),
      ]);

      expect(callCount).toBe(2);
    });
  });

  describe("memory eviction", () => {
    it("evicts oldest entry when at capacity", async () => {
      const small = new CacheService(null, makeConfigService(), {
        memoryMaxEntries: 3,
      });
      await small.set("a", 1, [], 60);
      await small.set("b", 2, [], 60);
      await small.set("c", 3, [], 60);
      await small.set("d", 4, [], 60); // should evict "a"

      expect(await small.has("a")).toBe(false);
      expect(await small.has("d")).toBe(true);
    });
  });

  describe("memorySize", () => {
    it("reports the current number of memory entries", async () => {
      expect(service.memorySize).toBe(0);
      await service.set("a", 1, [], 60);
      expect(service.memorySize).toBe(1);
      await service.del("a");
      expect(service.memorySize).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// CacheService key generation integration
// ---------------------------------------------------------------------------

describe("CacheService key generation", () => {
  it("uses the configured prefix and version", async () => {
    const service = new CacheService(
      null,
      makeConfigService({ CACHE_VERSION: "v2" }),
      { prefix: "myapp:" },
    );
    await service.set("test", "val", []);
    const keys = Array.from((service as any).memoryCache.keys());
    expect(keys[0]).toMatch(/^myapp:v2:test:/);
  });
});

// ---------------------------------------------------------------------------
// @Cacheable decorator
// ---------------------------------------------------------------------------

describe("@Cacheable decorator", () => {
  let cacheService: CacheService;
  let statsService: CacheStatsService;

  beforeEach(() => {
    cacheService = new CacheService(
      null,
      makeConfigService({ CACHE_VERSION: "v1" }),
    );
    statsService = new CacheStatsService();
  });

  it("caches the return value of a method", async () => {
    let callCount = 0;

    class TestService {
      cacheService = cacheService;
      cacheStatsService = statsService;

      @Cacheable({ namespace: "test", ttlSeconds: 60 })
      async compute(x: number): Promise<number> {
        callCount++;
        return x * 2;
      }
    }

    const svc = new TestService();
    const r1 = await svc.compute(5);
    const r2 = await svc.compute(5);

    expect(r1).toBe(10);
    expect(r2).toBe(10);
    expect(callCount).toBe(1); // Only called once
  });

  it("different arguments produce different cache entries", async () => {
    let callCount = 0;

    class TestService {
      cacheService = cacheService;
      cacheStatsService = statsService;

      @Cacheable({ namespace: "math", ttlSeconds: 60 })
      async square(x: number): Promise<number> {
        callCount++;
        return x * x;
      }
    }

    const svc = new TestService();
    await svc.square(3);
    await svc.square(4);

    expect(callCount).toBe(2);
  });

  it("works with custom keyBuilder", async () => {
    let callCount = 0;

    class TestService {
      cacheService = cacheService;
      cacheStatsService = statsService;

      @Cacheable({
        namespace: "lookup",
        ttlSeconds: 60,
        keyBuilder: (id: unknown) => `id:${id}`,
      })
      async find(id: string): Promise<string> {
        callCount++;
        return `found-${id}`;
      }
    }

    const svc = new TestService();
    const r1 = await svc.find("abc");
    const r2 = await svc.find("abc");

    expect(r1).toBe("found-abc");
    expect(r2).toBe("found-abc");
    expect(callCount).toBe(1);
  });

  it("does not cache when CacheService is not available", async () => {
    let callCount = 0;

    class NoCacheService {
      // no cacheService property

      @Cacheable({ namespace: "test", ttlSeconds: 60 })
      async compute(x: number): Promise<number> {
        callCount++;
        return x;
      }
    }

    const svc = new NoCacheService();
    await svc.compute(1);
    await svc.compute(1);

    expect(callCount).toBe(2); // Called both times (no caching)
  });

  it("re-throws errors from the original method", async () => {
    class TestService {
      cacheService = cacheService;

      @Cacheable({ namespace: "err", ttlSeconds: 60 })
      async fail(): Promise<never> {
        throw new Error("boom");
      }
    }

    const svc = new TestService();
    await expect(svc.fail()).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// @CacheInvalidate decorator
// ---------------------------------------------------------------------------

describe("@CacheInvalidate decorator", () => {
  let cacheService: CacheService;

  beforeEach(() => {
    cacheService = new CacheService(
      null,
      makeConfigService({ CACHE_VERSION: "v1" }),
    );
  });

  it("invalidates specified namespaces on success", async () => {
    await cacheService.set("user", { name: "A" }, [1], 60);
    await cacheService.set("user", { name: "B" }, [2], 60);

    class UserService {
      cacheService = cacheService;

      @CacheInvalidate({ namespaces: ["user"] })
      async update(_id: string): Promise<string> {
        return "updated";
      }
    }

    const svc = new UserService();
    const result = await svc.update("1");

    expect(result).toBe("updated");
    // Give invalidation a tick to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(await cacheService.get("user", 1)).toBeNull();
    expect(await cacheService.get("user", 2)).toBeNull();
  });

  it("does not invalidate on failure when onlyOnSuccess is true", async () => {
    await cacheService.set("user", { name: "A" }, [1], 60);

    class UserService {
      cacheService = cacheService;

      @CacheInvalidate({ namespaces: ["user"], onlyOnSuccess: true })
      async failUpdate(): Promise<string> {
        throw new Error("update failed");
      }
    }

    const svc = new UserService();
    try {
      await svc.failUpdate();
    } catch {
      // expected
    }
    await new Promise((r) => setTimeout(r, 10));

    expect(await cacheService.get("user", 1)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CacheTag
// ---------------------------------------------------------------------------

describe("CacheTag", () => {
  it("returns the correct string representation", () => {
    const tag = new CacheTag("important");
    expect(tag.toString()).toBe("tag:important");
  });
});

// ---------------------------------------------------------------------------
// CacheInvalidationService
// ---------------------------------------------------------------------------

describe("CacheInvalidationService", () => {
  let cache: CacheService;
  let invalidation: CacheInvalidationService;

  beforeEach(() => {
    cache = new CacheService(
      null,
      makeConfigService({ CACHE_VERSION: "v1" }),
    );
    invalidation = new CacheInvalidationService(cache);
  });

  it("invalidates by prefix", async () => {
    await cache.set("user", { id: 1 }, [1], 60);
    await cache.set("portfolio", { id: 1 }, [1], 60);

    await invalidation.execute([
      {
        type: InvalidationStrategyType.PREFIX,
        value: "user",
      },
    ]);

    await new Promise((r) => setTimeout(r, 10));
    expect(await cache.get("user", 1)).toBeNull();
    expect(await cache.get("portfolio", 1)).not.toBeNull();
  });

  it("invalidates by pattern", async () => {
    await cache.set("user:profile", "a", [1], 60);
    await cache.set("user:settings", "b", [1], 60);

    // Use the key generator directly for patterns
    const pattern = cache.keys.namespacePrefix("user:profile");
    await invalidation.execute([
      {
        type: InvalidationStrategyType.PATTERN,
        value: pattern,
      },
    ]);

    await new Promise((r) => setTimeout(r, 10));
    expect(await cache.get("user:profile", 1)).toBeNull();
  });

  it("handles invalidation errors gracefully", async () => {
    // Should not throw
    await invalidation.execute([
      {
        type: InvalidationStrategyType.PREFIX,
        value: "nonexistent",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// CacheWarmingService
// ---------------------------------------------------------------------------

describe("CacheWarmingService", () => {
  let cache: CacheService;
  let warming: CacheWarmingService;

  beforeEach(() => {
    cache = new CacheService(
      null,
      makeConfigService({ CACHE_VERSION: "v1" }),
    );
    warming = new CacheWarmingService(cache);
  });

  it("skips when no warmers are registered", async () => {
    await warming.onModuleInit();
    // Should not throw
  });

  it("executes registered warmers", async () => {
    let warmed = false;
    warming.registerWarmer({
      name: "test-warmer",
      execute: async (c) => {
        warmed = true;
        await c.set("user", { warm: true }, [1], 60);
        return 1;
      },
    });

    await warming.onModuleInit();
    expect(warmed).toBe(true);
    expect(await cache.get("user", 1)).toEqual({ warm: true });
  });

  it("continues after a warmer fails", async () => {
    let secondRan = false;

    warming.registerWarmer({
      name: "failing",
      execute: async () => {
        throw new Error("warm failed");
      },
    });

    warming.registerWarmer({
      name: "succeeding",
      execute: async () => {
        secondRan = true;
        return 0;
      },
    });

    await warming.onModuleInit();
    expect(secondRan).toBe(true);
  });

  it("manual warm() returns totals", async () => {
    warming.registerWarmer({
      name: "count",
      execute: async () => 5,
    });

    const result = await warming.warm();
    expect(result.totalEntries).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("listWarmers returns registered names", () => {
    warming.registerWarmer({ name: "a", execute: async () => 0 });
    warming.registerWarmer({ name: "b", execute: async () => 0 });
    expect(warming.listWarmers()).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// CacheStatsService
// ---------------------------------------------------------------------------

describe("CacheStatsService", () => {
  let stats: CacheStatsService;

  beforeEach(() => {
    stats = new CacheStatsService();
  });

  it("returns zero stats initially", () => {
    const s = stats.getStats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.hitRate).toBe(0);
    expect(s.sets).toBe(0);
    expect(s.deletes).toBe(0);
    expect(s.errors).toBe(0);
  });

  it("tracks hits and misses", () => {
    stats.recordHit("user");
    stats.recordHit("user");
    stats.recordMiss("user");
    stats.recordHit("portfolio");

    const s = stats.getStats();
    expect(s.hits).toBe(3);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(0.75);
  });

  it("tracks sets and deletes", () => {
    stats.recordSet("user");
    stats.recordSet("user");
    stats.recordDelete("user");

    const s = stats.getStats();
    expect(s.sets).toBe(2);
    expect(s.deletes).toBe(1);
  });

  it("tracks errors", () => {
    stats.recordError("read");
    stats.recordError("write");

    const s = stats.getStats();
    expect(s.errors).toBe(2);
  });

  it("provides per-namespace breakdown", () => {
    stats.recordHit("user");
    stats.recordHit("user");
    stats.recordMiss("portfolio");

    const s = stats.getStats();
    expect(s.namespaces.user).toEqual({ hits: 2, misses: 0 });
    expect(s.namespaces.portfolio).toEqual({ hits: 0, misses: 1 });
  });

  it("reset clears all counters", () => {
    stats.recordHit("a");
    stats.recordMiss("b");
    stats.recordSet("c");
    stats.reset();

    const s = stats.getStats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.sets).toBe(0);
    expect(s.hitRate).toBe(0);
  });

  it("updateMemoryStats updates Prometheus gauges without throwing", () => {
    // Should not throw
    stats.updateMemoryStats(100, 50000);
    // The gauges are set — verify via Prometheus metrics
    const s = stats.getStats();
    // memoryEntries/memoryBytes in getStats are snapshots, not live gauges
    expect(s.memoryEntries).toBe(0); // always 0 from getStats (by design)
    expect(s.memoryBytes).toBe(0);
  });
});
