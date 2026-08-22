import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { CACHE_REDIS_CLIENT } from "../common/cache/cache.constants";
import {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimitEntry,
  RateLimitStorage,
  RateLimitStrategy,
} from "./interfaces";
import {
  rateLimitErrorsTotal,
  rateLimitStorageHealth,
} from "./rate-limiting.metrics";

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed_ms = now_ms - ts
local token_delta = elapsed_ms * rate_per_sec / 1000
tokens = math.min(capacity, tokens + token_delta)
ts = now_ms

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(ts))
  local ttl = math.ceil((capacity - tokens + 1) / rate_per_sec)
  if ttl < 1 then ttl = 1 end
  redis.call('EXPIRE', key, ttl)
  return {1, math.floor(tokens), 0}
else
  local wait_ms = math.ceil((cost - tokens) / rate_per_sec * 1000)
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(ts))
  local ttl = math.ceil((cost - tokens + 1) / rate_per_sec)
  if ttl < 1 then ttl = 1 end
  redis.call('EXPIRE', key, ttl)
  return {0, math.floor(tokens), wait_ms}
end
`;

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local request_id = ARGV[4]

local min_score = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, 0, min_score)

local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now_ms, request_id)
  redis.call('PEXPIRE', key, window_ms)
  return {1, limit - count - 1, 0}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_at = now_ms
  if #oldest > 0 then
    reset_at = tonumber(oldest[2]) + window_ms
  end
  local retry_after = math.max(0, reset_at - now_ms)
  return {0, 0, retry_after}
end
`;

interface MemoryTokenBucketState {
  tokens: number;
  ts: number;
}

interface MemoryEntry {
  tracker: string;
  scope: string;
  tier: string;
  strategy: RateLimitStrategy;
  limit: number;
  windowMs: number;
  burst: number;
  allowed: number;
  denied: number;
  lastResetAt: number;
  lastRemaining: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redis: Redis | null;
  private readonly memoryBuckets = new Map<string, MemoryTokenBucketState>();
  private readonly memoryWindows = new Map<string, number[]>();
  private readonly registry = new Map<string, MemoryEntry>();
  private readonly keyPrefix: string;
  private readonly defaultStrategy: RateLimitStrategy;
  private readonly enableFallback: boolean;
  private lastRedisCheck = 0;
  private redisHealthy = false;

  constructor(
    @Optional() @Inject(CACHE_REDIS_CLIENT) redis: Redis | null,
    @Inject("RATE_LIMIT_CONFIG") config?: RateLimitConfig,
  ) {
    this.redis = redis;
    this.keyPrefix = config?.keyPrefix ?? "alian:rl:";
    this.defaultStrategy =
      config?.defaultStrategy ?? RateLimitStrategy.TokenBucket;
    this.enableFallback = config?.enableFallback ?? true;
  }

  async consume(
    key: string,
    policy: Partial<RateLimitPolicy>,
    tracker?: string,
    scope?: string,
    tier?: string,
  ): Promise<RateLimitDecision> {
    const resolvedPolicy: RateLimitPolicy = {
      limit: policy.limit ?? 60,
      windowMs: policy.windowMs ?? 60_000,
      burst: policy.burst ?? policy.limit ?? 60,
      strategy: policy.strategy ?? this.defaultStrategy,
    };

    const storageKey = `${this.keyPrefix}${key}`;

    let decision: RateLimitDecision;

    if (this.redis && (await this.isRedisHealthy())) {
      decision = await this.consumeRedis(storageKey, resolvedPolicy);
    } else {
      decision = await this.consumeMemory(storageKey, resolvedPolicy);
    }

    this.updateRegistry(key, tracker, scope, tier, resolvedPolicy, decision);

    return decision;
  }

  private async consumeRedis(
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    try {
      const ratePerSec = policy.limit / (policy.windowMs / 1000);

      let result: [number, number, number];

      if (policy.strategy === RateLimitStrategy.SlidingWindow) {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        result = (await this.redis!.eval(
          SLIDING_WINDOW_LUA,
          1,
          key,
          policy.limit,
          policy.windowMs,
          Date.now(),
          requestId,
        )) as [number, number, number];
      } else {
        result = (await this.redis!.eval(
          TOKEN_BUCKET_LUA,
          1,
          key,
          policy.burst,
          ratePerSec,
          Date.now(),
          1,
        )) as [number, number, number];
      }

      const [allowed, remaining, retryAfterMs] = result;

      let resetAt: number;
      if (policy.strategy === RateLimitStrategy.SlidingWindow) {
        resetAt =
          retryAfterMs > 0
            ? Date.now() + retryAfterMs
            : Date.now() + policy.windowMs;
      } else {
        resetAt =
          retryAfterMs > 0
            ? Date.now() + retryAfterMs
            : Date.now() +
              Math.ceil(((policy.burst - remaining) / ratePerSec) * 1000);
      }

      return {
        allowed: allowed === 1,
        remaining: Math.max(0, remaining),
        resetAt,
        retryAfterMs: retryAfterMs > 0 ? retryAfterMs : undefined,
      };
    } catch (err) {
      rateLimitErrorsTotal.inc({ operation: "consume", storage: "redis" });
      this.logger.warn(
        { error: err.message, key },
        "Redis rate-limit consume failed, falling back to memory",
      );
      return this.consumeMemory(key, policy);
    }
  }

  private async consumeMemory(
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    const now = Date.now();

    if (policy.strategy === RateLimitStrategy.SlidingWindow) {
      return this.consumeMemorySlidingWindow(key, policy, now);
    }

    return this.consumeMemoryTokenBucket(key, policy, now);
  }

  private consumeMemoryTokenBucket(
    key: string,
    policy: RateLimitPolicy,
    now: number,
  ): RateLimitDecision {
    const ratePerSec = policy.limit / (policy.windowMs / 1000);
    const state = this.memoryBuckets.get(key);

    let tokens = policy.burst;
    let ts = now;

    if (state) {
      const elapsed = now - state.ts;
      const refill = (elapsed * ratePerSec) / 1000;
      tokens = Math.min(policy.burst, state.tokens + refill);
      ts = now;
    }

    const allowed = tokens >= 1;
    if (allowed) {
      tokens -= 1;
    }

    this.memoryBuckets.set(key, { tokens, ts });

    const remaining = Math.max(0, Math.floor(tokens));
    let retryAfterMs: number | undefined;
    let resetAt = now;

    if (!allowed) {
      retryAfterMs = Math.ceil(((1 - tokens) / ratePerSec) * 1000);
      resetAt = now + retryAfterMs;
    } else {
      resetAt = now + Math.ceil(((policy.burst - tokens) / ratePerSec) * 1000);
    }

    return {
      allowed,
      remaining,
      resetAt,
      retryAfterMs,
    };
  }

  private consumeMemorySlidingWindow(
    key: string,
    policy: RateLimitPolicy,
    now: number,
  ): RateLimitDecision {
    const windowStart = now - policy.windowMs;
    let entries = this.memoryWindows.get(key);
    if (!entries) {
      entries = [];
      this.memoryWindows.set(key, entries);
    }

    entries = entries.filter((ts) => ts > windowStart);
    this.memoryWindows.set(key, entries);

    const count = entries.length;

    if (count < policy.limit) {
      entries.push(now);
      const remaining = policy.limit - count - 1;
      return {
        allowed: true,
        remaining: Math.max(0, remaining),
        resetAt: now + policy.windowMs,
      };
    }

    const oldest = entries[0];
    const retryAfterMs = Math.max(0, oldest + policy.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + policy.windowMs,
      retryAfterMs,
    };
  }

  async getEntry(key: string): Promise<RateLimitEntry | null> {
    const entry = this.registry.get(key);
    if (!entry) return null;

    let remaining: number;
    let resetAt: number;

    if (this.redis && (await this.isRedisHealthy())) {
      try {
        if (entry.strategy === RateLimitStrategy.SlidingWindow) {
          const windowStart = Date.now() - entry.windowMs;
          const count = await this.redis!.zcount(
            `${this.keyPrefix}${key}`,
            windowStart,
            "+inf",
          );
          remaining = Math.max(0, entry.limit - count);
        } else {
          const data = await this.redis!.hgetall(`${this.keyPrefix}${key}`);
          const tokens = parseFloat(data.tokens ?? "0");
          remaining = Math.max(0, Math.floor(tokens));
        }
        resetAt = entry.lastResetAt;
      } catch {
        remaining = entry.lastRemaining;
        resetAt = entry.lastResetAt;
      }
    } else {
      remaining = entry.lastRemaining;
      resetAt = entry.lastResetAt;
    }

    return {
      key,
      tracker: entry.tracker,
      scope: entry.scope,
      tier: entry.tier,
      strategy: entry.strategy,
      limit: entry.limit,
      windowMs: entry.windowMs,
      remaining,
      resetAt,
    };
  }

  async reset(key: string): Promise<boolean> {
    if (this.redis && (await this.isRedisHealthy())) {
      try {
        await this.redis!.del(`${this.keyPrefix}${key}`);
        this.registry.delete(key);
        return true;
      } catch {
        // fall through to memory
      }
    }

    this.memoryBuckets.delete(`${this.keyPrefix}${key}`);
    this.memoryWindows.delete(`${this.keyPrefix}${key}`);
    this.registry.delete(key);
    return true;
  }

  listEntries(limit = 100): RateLimitEntry[] {
    return Array.from(this.registry.entries())
      .slice(0, limit)
      .map(([key, entry]) => ({
        key,
        tracker: entry.tracker,
        scope: entry.scope,
        tier: entry.tier,
        strategy: entry.strategy,
        limit: entry.limit,
        windowMs: entry.windowMs,
        remaining: entry.lastRemaining,
        resetAt: entry.lastResetAt,
      }));
  }

  async getStorageHealth(): Promise<RateLimitStorage> {
    if (!this.redis) return "memory";
    const healthy = await this.isRedisHealthy();
    return healthy ? "redis" : "memory";
  }

  private async isRedisHealthy(): Promise<boolean> {
    if (!this.redis) return false;

    const now = Date.now();
    if (now - this.lastRedisCheck < 5_000) {
      return this.redisHealthy;
    }
    this.lastRedisCheck = now;

    try {
      await this.redis.ping();
      this.redisHealthy = true;
      rateLimitStorageHealth.set({ storage: "redis" }, 1);
      rateLimitStorageHealth.set({ storage: "memory" }, 0);
    } catch {
      this.redisHealthy = false;
      rateLimitStorageHealth.set({ storage: "redis" }, 0);
      rateLimitStorageHealth.set({ storage: "memory" }, 1);
    }

    return this.redisHealthy;
  }

  private updateRegistry(
    key: string,
    tracker: string | undefined,
    scope: string | undefined,
    tier: string | undefined,
    policy: RateLimitPolicy,
    decision: RateLimitDecision,
  ): void {
    const existing = this.registry.get(key);
    this.registry.set(key, {
      tracker: tracker ?? existing?.tracker ?? "unknown",
      scope: scope ?? existing?.scope ?? "global",
      tier: tier ?? existing?.tier ?? "free",
      strategy: policy.strategy,
      limit: policy.limit,
      windowMs: policy.windowMs,
      burst: policy.burst,
      allowed: (existing?.allowed ?? 0) + (decision.allowed ? 1 : 0),
      denied: (existing?.denied ?? 0) + (decision.allowed ? 0 : 1),
      lastResetAt: decision.resetAt,
      lastRemaining: decision.remaining,
    });
  }
}

export interface RateLimitConfig {
  keyPrefix?: string;
  defaultStrategy?: RateLimitStrategy;
  enableFallback?: boolean;
}
