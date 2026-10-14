import { Injectable } from "@nestjs/common";
import {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimitStrategy,
} from "../interfaces";
import { IRateLimitStrategy } from "./rate-limit-strategy.interface";

interface MemoryTokenBucketState {
  tokens: number;
  ts: number;
}

@Injectable()
export class MemoryRateLimitStrategy implements IRateLimitStrategy {
  private readonly memoryBuckets = new Map<string, MemoryTokenBucketState>();
  private readonly memoryWindows = new Map<string, number[]>();

  consume(key: string, policy: RateLimitPolicy): RateLimitDecision {
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

    const oldest = entries[0] ?? now;
    const retryAfterMs = Math.max(0, oldest + policy.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + policy.windowMs,
      retryAfterMs,
    };
  }

  reset(key: string): boolean {
    this.memoryBuckets.delete(key);
    this.memoryWindows.delete(key);
    return true;
  }
}