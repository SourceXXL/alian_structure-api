import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { CACHE_REDIS_CLIENT } from "../../common/cache/cache.constants";
import { generateTimestampedId } from "src/common/utils/random-id";
import { RateLimitAnalytics, RateLimitViolation } from "../interfaces";

@Injectable()
export class ViolationsService {
  private readonly logger = new Logger(ViolationsService.name);
  private readonly memoryViolations: RateLimitViolation[] = [];

  constructor(
    @Optional()
    @Inject(CACHE_REDIS_CLIENT)
    private readonly redis: Redis | null = null,
  ) {}

  async recordViolation(
    violation: Omit<RateLimitViolation, "id" | "timestamp">,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<RateLimitViolation> {
    const record: RateLimitViolation = {
      ...violation,
      id: generateTimestampedId(),
      timestamp: Date.now(),
    };

    this.memoryViolations.unshift(record);
    if (this.memoryViolations.length > 2000) {
      this.memoryViolations.length = 2000;
    }

    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        await this.redis.lpush(
          `${keyPrefix}violations`,
          JSON.stringify(record),
        );
        await this.redis.ltrim(`${keyPrefix}violations`, 0, 1999);
      } catch (err: any) {
        this.logger.warn(
          { error: err?.message },
          "Failed to store violation in Redis",
        );
      }
    }

    return record;
  }

  async getViolations(
    filter?: {
      tracker?: string;
      ip?: string;
      userId?: string;
      route?: string;
      limit?: number;
      since?: number;
    },
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<RateLimitViolation[]> {
    let list: RateLimitViolation[] = [];

    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        const raw = await this.redis.lrange(
          `${keyPrefix}violations`,
          0,
          filter?.limit ? Math.min(filter.limit * 2, 500) : 500,
        );
        list = raw.map((r) => JSON.parse(r));
      } catch {
        list = [...this.memoryViolations];
      }
    } else {
      list = [...this.memoryViolations];
    }

    const since = filter?.since ?? 0;
    let filtered = list.filter((v) => v.timestamp >= since);

    if (filter?.tracker) {
      filtered = filtered.filter((v) => v.tracker === filter.tracker);
    }
    if (filter?.ip) {
      filtered = filtered.filter((v) => v.ip === filter.ip);
    }
    if (filter?.userId) {
      filtered = filtered.filter((v) => v.userId === filter.userId);
    }
    if (filter?.route) {
      filtered = filtered.filter((v) => v.route.includes(filter.route!));
    }

    const limit = filter?.limit ?? 100;
    return filtered.slice(0, limit);
  }

  async getAnalytics(
    sinceMs = 3600_000,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<RateLimitAnalytics> {
    const since = Date.now() - sinceMs;
    const violations = await this.getViolations(
      { since, limit: 2000 },
      keyPrefix,
      isRedisHealthy,
    );

    const violatorCounts: Record<string, number> = {};
    const routeCounts: Record<string, number> = {};
    const tierCounts: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};
    const timeBuckets: Record<string, number> = {};

    for (const v of violations) {
      const trackerKey = v.tracker || v.ip || "unknown";
      violatorCounts[trackerKey] = (violatorCounts[trackerKey] ?? 0) + 1;
      routeCounts[v.route] = (routeCounts[v.route] ?? 0) + 1;
      tierCounts[v.tier] = (tierCounts[v.tier] ?? 0) + 1;
      strategyCounts[v.strategy] = (strategyCounts[v.strategy] ?? 0) + 1;

      const bucket = new Date(
        Math.floor(v.timestamp / 300_000) * 300_000,
      ).toISOString();
      timeBuckets[bucket] = (timeBuckets[bucket] ?? 0) + 1;
    }

    const topViolators = Object.entries(violatorCounts)
      .map(([tracker, count]) => ({ tracker, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topRoutes = Object.entries(routeCounts)
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const timeSeries = Object.entries(timeBuckets)
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => a.time.localeCompare(b.time));

    return {
      timestamp: new Date().toISOString(),
      totalViolations: violations.length,
      uniqueViolators: Object.keys(violatorCounts).length,
      topViolators,
      topRoutes,
      violationsByTier: tierCounts,
      violationsByStrategy: strategyCounts,
      timeSeries,
    };
  }
}