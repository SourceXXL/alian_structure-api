import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { Public } from "../decorators/public.decorator";
import { SkipKyc } from "../decorators/skip-kyc.decorator";
import { CacheService } from "./cache.service";
import { CacheStatsService } from "./cache-stats.service";
import { CacheWarmingService } from "./cache-warming.service";

/**
 * Cache management and monitoring endpoints.
 *
 * - `GET  /cache/stats`              — Cache hit/miss stats and memory usage
 * - `POST /cache/warm`               — Manually trigger cache warming
 * - `DELETE /cache/:namespace`       — Invalidate all keys under a namespace
 * - `GET  /cache/:namespace/keys`    — List keys matching a namespace
 * - `DELETE /cache`                  — Clear the entire cache
 *
 * Protected by `METRICS_AUTH_TOKEN` when configured.
 */
@ApiTags("Cache")
@Controller()
@Public()
@SkipKyc()
export class CacheController {
  constructor(
    private readonly cache: CacheService,
    private readonly stats: CacheStatsService,
    private readonly warming: CacheWarmingService,
  ) {}

  @Get("cache/stats")
  @ApiOperation({ summary: "Cache statistics and hit rates" })
  @ApiResponse({ status: 200, description: "Cache statistics" })
  async getStats(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertAuthorized(req);

    const baseStats = this.stats.getStats();
    const isConnected = await this.cache.isRedisConnected();
    const memoryEstimate = this.estimateMemoryUsage();

    this.stats.updateMemoryStats(
      baseStats.memoryEntries,
      memoryEstimate,
    );

    return {
      ...baseStats,
      memoryEntries: this.cache.client
        ? "N/A (Redis)"
        : baseStats.memoryEntries,
      memoryBytes: memoryEstimate,
      redisConnected: isConnected,
      registeredWarmers: this.warming.listWarmers(),
    };
  }

  @Post("cache/warm")
  @ApiOperation({ summary: "Manually trigger cache warming" })
  @ApiResponse({ status: 200, description: "Cache warming result" })
  async warmCache(
    @Req() req: Request,
  ) {
    this.assertAuthorized(req);

    const result = await this.warming.warm();
    return {
      message: "Cache warming completed",
      ...result,
    };
  }

  @Delete("cache/:namespace")
  @ApiOperation({ summary: "Invalidate all cache entries under a namespace" })
  @ApiResponse({ status: 200, description: "Invalidation result" })
  async invalidateNamespace(
    @Param("namespace") namespace: string,
    @Req() req: Request,
  ) {
    this.assertAuthorized(req);

    const deleted = await this.cache.invalidatePrefix(namespace);
    return {
      namespace,
      deleted,
      message: `Invalidated ${deleted} entries under "${namespace}"`,
    };
  }

  @Get("cache/:namespace/keys")
  @ApiOperation({ summary: "List cached keys under a namespace" })
  @ApiResponse({ status: 200, description: "Key list" })
  async listKeys(
    @Param("namespace") namespace: string,
    @Req() req: Request,
  ) {
    this.assertAuthorized(req);

    const keys: string[] = [];
    if (this.cache.client) {
      try {
        let cursor = "0";
        const pattern = this.cache.keys.namespacePrefix(namespace);
        do {
          const [nextCursor, found] = await this.cache.client.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            200,
          );
          cursor = nextCursor;
          keys.push(...found);
        } while (cursor !== "0");
      } catch {
        // Redis unavailable
      }
    }

    return {
      namespace,
      count: keys.length,
      keys,
    };
  }

  @Delete("cache")
  @ApiOperation({ summary: "Clear the entire cache" })
  @ApiResponse({ status: 200, description: "Cache cleared" })
  async clearCache(@Req() req: Request) {
    this.assertAuthorized(req);

    await this.cache.clear();
    return { message: "Cache cleared" };
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  private assertAuthorized(req: Request): void {
    const expected = process.env.METRICS_AUTH_TOKEN;
    if (!expected) return;

    const header = req.headers["authorization"];
    const headerToken =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : undefined;
    const queryToken =
      typeof req.query?.token === "string" ? req.query.token : undefined;
    const provided = headerToken ?? queryToken;

    if (!provided || !this.constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException("Invalid or missing cache token");
    }
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingTimeEquals(bufA, bufB);
  }

  private estimateMemoryUsage(): number {
    // Rough estimate: average 500 bytes per entry (key + value)
    return this.stats.getStats().memoryEntries * 500;
  }
}

/** Alias to avoid name clash with the method-level constant. */
const timingTimeEquals = timingSafeEqual;
