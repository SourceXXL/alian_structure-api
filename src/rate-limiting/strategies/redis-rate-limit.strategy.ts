import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { CACHE_REDIS_CLIENT } from "../../common/cache/cache.constants";
import {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimitStrategy,
} from "../interfaces";
import { IRateLimitStrategy } from "./rate-limit-strategy.interface";

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

@Injectable()
export class RedisRateLimitStrategy implements IRateLimitStrategy {
  private readonly logger = new Logger(RedisRateLimitStrategy.name);

  constructor(
    @Optional()
    @Inject(CACHE_REDIS_CLIENT)
    private readonly redis: Redis | null = null,
  ) {}

  async consume(
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    if (!this.redis) {
      throw new Error("Redis client unavailable");
    }

    const ratePerSec = policy.limit / (policy.windowMs / 1000);
    let result: [number, number, number];

    if (policy.strategy === RateLimitStrategy.SlidingWindow) {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      result = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        policy.limit,
        policy.windowMs,
        Date.now(),
        requestId,
      )) as [number, number, number];
    } else {
      result = (await this.redis.eval(
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
  }

  async reset(key: string): Promise<boolean> {
    if (!this.redis) return false;
    await this.redis.del(key);
    return true;
  }
}