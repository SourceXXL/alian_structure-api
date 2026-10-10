import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { CACHE_REDIS_CLIENT } from "../common/cache/cache.constants";
import {
  BlacklistEntry,
  EndpointRateLimitRule,
  RateLimitAnalytics,
  RateLimitDecision,
  RateLimitEntry,
  RateLimitPolicy,
  RateLimitStorage,
  RateLimitStrategy,
  RateLimitViolation,
  WhitelistEntry,
} from "./interfaces";
import {
  rateLimitErrorsTotal,
  rateLimitStorageHealth,
} from "./rate-limiting.metrics";
import { MemoryRateLimitStrategy } from "./strategies/memory-rate-limit.strategy";
import { RedisRateLimitStrategy } from "./strategies/redis-rate-limit.strategy";
import { ViolationsService } from "./violations/violations.service";
import { PolicyService } from "./policies/policy.service";

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

export interface RateLimitConfig {
  keyPrefix?: string;
  defaultStrategy?: RateLimitStrategy;
  enableFallback?: boolean;
  endpointRules?: EndpointRateLimitRule[];
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redis: Redis | null;
  private readonly registry = new Map<string, MemoryEntry>();
  private readonly keyPrefix: string;
  private readonly defaultStrategy: RateLimitStrategy;
  private readonly enableFallback: boolean;

  private readonly memoryStrategy: MemoryRateLimitStrategy;
  private readonly redisStrategy: RedisRateLimitStrategy;
  private readonly violationsService: ViolationsService;
  private readonly policyService: PolicyService;

  private lastRedisCheck = 0;
  private redisHealthy = false;

  constructor(
    @Optional() @Inject(CACHE_REDIS_CLIENT) redis: Redis | null,
    @Optional() @Inject("RATE_LIMIT_CONFIG") config?: RateLimitConfig,
    @Optional() memoryStrategy?: MemoryRateLimitStrategy,
    @Optional() redisStrategy?: RedisRateLimitStrategy,
    @Optional() violationsService?: ViolationsService,
    @Optional() policyService?: PolicyService,
  ) {
    this.redis = redis;
    this.keyPrefix = config?.keyPrefix ?? "alian:rl:";
    this.defaultStrategy =
      config?.defaultStrategy ?? RateLimitStrategy.TokenBucket;
    this.enableFallback = config?.enableFallback ?? true;

    this.memoryStrategy = memoryStrategy ?? new MemoryRateLimitStrategy();
    this.redisStrategy = redisStrategy ?? new RedisRateLimitStrategy(this.redis);
    this.violationsService = violationsService ?? new ViolationsService(this.redis);
    this.policyService = policyService ?? new PolicyService(this.redis);

    if (config?.endpointRules) {
      for (const rule of config.endpointRules) {
        this.policyService.addEndpointRule(rule);
      }
    }
  }

  async consume(
    key: string,
    policy: Partial<RateLimitPolicy>,
    tracker?: string | null,
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
      try {
        decision = await this.redisStrategy.consume(storageKey, resolvedPolicy);
      } catch (err: any) {
        rateLimitErrorsTotal.inc({ operation: "consume", storage: "redis" });
        this.logger.warn(
          { error: err?.message, key },
          "Redis rate-limit consume failed, falling back to memory",
        );
        decision = this.memoryStrategy.consume(storageKey, resolvedPolicy);
      }
    } else {
      decision = this.memoryStrategy.consume(storageKey, resolvedPolicy);
    }

    this.updateRegistry(
      key,
      tracker ?? undefined,
      scope,
      tier,
      resolvedPolicy,
      decision,
    );

    return decision;
  }

  async addWhitelist(
    entry: Omit<WhitelistEntry, "id" | "createdAt">,
  ): Promise<WhitelistEntry> {
    return this.policyService.addWhitelist(
      entry,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async removeWhitelist(value: string): Promise<boolean> {
    return this.policyService.removeWhitelist(
      value,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async listWhitelist(): Promise<WhitelistEntry[]> {
    return this.policyService.listWhitelist(
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async isWhitelisted(
    ip?: string,
    userId?: string,
    key?: string,
    path?: string,
  ): Promise<boolean> {
    return this.policyService.isWhitelisted(
      ip,
      userId,
      key,
      path,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async addBlacklist(
    entry: Omit<BlacklistEntry, "id" | "createdAt">,
  ): Promise<BlacklistEntry> {
    return this.policyService.addBlacklist(
      entry,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async removeBlacklist(value: string): Promise<boolean> {
    return this.policyService.removeBlacklist(
      value,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async listBlacklist(): Promise<BlacklistEntry[]> {
    return this.policyService.listBlacklist(
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async isBlacklisted(
    ip?: string,
    userId?: string,
    key?: string,
  ): Promise<boolean> {
    return this.policyService.isBlacklisted(
      ip,
      userId,
      key,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async recordViolation(
    violation: Omit<RateLimitViolation, "id" | "timestamp">,
  ): Promise<RateLimitViolation> {
    return this.violationsService.recordViolation(
      violation,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async getViolations(filter?: {
    tracker?: string;
    ip?: string;
    userId?: string;
    route?: string;
    limit?: number;
    since?: number;
  }): Promise<RateLimitViolation[]> {
    return this.violationsService.getViolations(
      filter,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  async getAnalytics(sinceMs = 3600_000): Promise<RateLimitAnalytics> {
    return this.violationsService.getAnalytics(
      sinceMs,
      this.keyPrefix,
      () => this.isRedisHealthy(),
    );
  }

  addEndpointRule(rule: EndpointRateLimitRule): void {
    this.policyService.addEndpointRule(rule);
  }

  getEndpointRule(
    path: string,
    method?: string,
  ): EndpointRateLimitRule | undefined {
    return this.policyService.getEndpointRule(path, method);
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
          const count = await this.redis.zcount(
            `${this.keyPrefix}${key}`,
            windowStart,
            "+inf",
          );
          remaining = Math.max(0, entry.limit - count);
        } else {
          const data = await this.redis.hgetall(`${this.keyPrefix}${key}`);
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
      allowed: entry.allowed,
      denied: entry.denied,
    };
  }

  async reset(key: string): Promise<boolean> {
    if (this.redis && (await this.isRedisHealthy())) {
      try {
        await this.redis.del(`${this.keyPrefix}${key}`);
        this.registry.delete(key);
        return true;
      } catch {
        // fall through to memory
      }
    }

    this.memoryStrategy.reset(`${this.keyPrefix}${key}`);
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
        allowed: entry.allowed,
        denied: entry.denied,
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