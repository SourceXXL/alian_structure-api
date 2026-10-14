import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { CACHE_REDIS_CLIENT } from "../../common/cache/cache.constants";
import {
  BlacklistEntry,
  EndpointRateLimitRule,
  WhitelistEntry,
} from "../interfaces";

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private readonly memoryWhitelist = new Map<string, WhitelistEntry>();
  private readonly memoryBlacklist = new Map<string, BlacklistEntry>();
  private readonly endpointRules: EndpointRateLimitRule[] = [];

  constructor(
    @Optional()
    @Inject(CACHE_REDIS_CLIENT)
    private readonly redis: Redis | null = null,
  ) {}

  addEndpointRule(rule: EndpointRateLimitRule): void {
    this.endpointRules.push(rule);
  }

  getEndpointRule(
    path: string,
    method?: string,
  ): EndpointRateLimitRule | undefined {
    return this.endpointRules.find((rule) => {
      const methodMatch =
        !rule.method ||
        rule.method === "*" ||
        rule.method.toUpperCase() === method?.toUpperCase();
      const pathMatch = this.matchPathPattern(path, rule.pathPattern);
      return methodMatch && pathMatch;
    });
  }

  getEndpointRules(): EndpointRateLimitRule[] {
    return [...this.endpointRules];
  }

  async addWhitelist(
    entry: Omit<WhitelistEntry, "id" | "createdAt">,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<WhitelistEntry> {
    const item: WhitelistEntry = {
      id: `${entry.type}:${entry.value}`,
      type: entry.type,
      value: entry.value.trim().toLowerCase(),
      reason: entry.reason,
      createdAt: Date.now(),
      expiresAt: entry.expiresAt,
    };

    this.memoryWhitelist.set(item.id, item);

    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        await this.redis.hset(
          `${keyPrefix}whitelist`,
          item.id,
          JSON.stringify(item),
        );
      } catch (err: any) {
        this.logger.warn(
          { error: err?.message },
          "Failed to persist whitelist to Redis",
        );
      }
    }

    return item;
  }

  async removeWhitelist(
    value: string,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<boolean> {
    const norm = value.trim().toLowerCase();
    let removed = false;

    for (const [id, entry] of this.memoryWhitelist.entries()) {
      if (entry.value === norm || id === value) {
        this.memoryWhitelist.delete(id);
        removed = true;
      }
    }

    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        await this.redis.hdel(`${keyPrefix}whitelist`, value, norm);
      } catch (err: any) {
        this.logger.warn(
          { error: err?.message },
          "Failed to remove whitelist from Redis",
        );
      }
    }

    return removed;
  }

  async listWhitelist(
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<WhitelistEntry[]> {
    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        const raw = await this.redis.hgetall(`${keyPrefix}whitelist`);
        return Object.values(raw).map((v) => JSON.parse(v));
      } catch {
        return Array.from(this.memoryWhitelist.values());
      }
    }
    return Array.from(this.memoryWhitelist.values());
  }

  async isWhitelisted(
    ip?: string,
    userId?: string,
    key?: string,
    path?: string,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<boolean> {
    const entries = await this.listWhitelist(keyPrefix, isRedisHealthy);
    const now = Date.now();

    for (const entry of entries) {
      if (entry.expiresAt && entry.expiresAt < now) continue;

      if (entry.type === "ip" && ip) {
        if (this.matchIpPattern(ip, entry.value)) return true;
      }
      if (entry.type === "user" && userId) {
        if (entry.value === userId.toLowerCase()) return true;
      }
      if (entry.type === "key" && key) {
        if (entry.value === key.toLowerCase()) return true;
      }
      if (entry.type === "path" && path) {
        if (this.matchPathPattern(path, entry.value)) return true;
      }
    }

    return false;
  }

  async addBlacklist(
    entry: Omit<BlacklistEntry, "id" | "createdAt">,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<BlacklistEntry> {
    const item: BlacklistEntry = {
      id: `${entry.type}:${entry.value}`,
      type: entry.type,
      value: entry.value.trim().toLowerCase(),
      reason: entry.reason,
      createdAt: Date.now(),
      expiresAt: entry.expiresAt,
    };

    this.memoryBlacklist.set(item.id, item);

    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        await this.redis.hset(
          `${keyPrefix}blacklist`,
          item.id,
          JSON.stringify(item),
        );
      } catch (err: any) {
        this.logger.warn(
          { error: err?.message },
          "Failed to persist blacklist to Redis",
        );
      }
    }

    return item;
  }

  async removeBlacklist(
    value: string,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<boolean> {
    const norm = value.trim().toLowerCase();
    let removed = false;

    for (const [id, entry] of this.memoryBlacklist.entries()) {
      if (entry.value === norm || id === value) {
        this.memoryBlacklist.delete(id);
        removed = true;
      }
    }

    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        await this.redis.hdel(`${keyPrefix}blacklist`, value, norm);
      } catch (err: any) {
        this.logger.warn(
          { error: err?.message },
          "Failed to remove blacklist from Redis",
        );
      }
    }

    return removed;
  }

  async listBlacklist(
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<BlacklistEntry[]> {
    const redisOk =
      this.redis && (isRedisHealthy ? await isRedisHealthy() : true);
    if (redisOk && this.redis) {
      try {
        const raw = await this.redis.hgetall(`${keyPrefix}blacklist`);
        return Object.values(raw).map((v) => JSON.parse(v));
      } catch {
        return Array.from(this.memoryBlacklist.values());
      }
    }
    return Array.from(this.memoryBlacklist.values());
  }

  async isBlacklisted(
    ip?: string,
    userId?: string,
    key?: string,
    keyPrefix = "alian:rl:",
    isRedisHealthy?: () => Promise<boolean>,
  ): Promise<boolean> {
    const entries = await this.listBlacklist(keyPrefix, isRedisHealthy);
    const now = Date.now();

    for (const entry of entries) {
      if (entry.expiresAt && entry.expiresAt < now) continue;

      if (entry.type === "ip" && ip) {
        if (this.matchIpPattern(ip, entry.value)) return true;
      }
      if (entry.type === "user" && userId) {
        if (entry.value === userId.toLowerCase()) return true;
      }
      if (entry.type === "key" && key) {
        if (entry.value === key.toLowerCase()) return true;
      }
    }

    return false;
  }

  private matchIpPattern(ip: string, pattern: string): boolean {
    if (pattern === ip || pattern === "*") return true;
    if (pattern.includes("/")) {
      return false;
    }
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return ip.startsWith(prefix);
    }
    return false;
  }

  private matchPathPattern(path: string, pattern: string): boolean {
    if (pattern === path || pattern === "*") return true;
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return path.startsWith(prefix);
    }
    return false;
  }
}