import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { timingSafeEqual } from "crypto";
import { Public } from "../common/decorators/public.decorator";
import { SkipKyc } from "../common/decorators/skip-kyc.decorator";
import { RateLimiterService } from "./rate-limiter.service";
import { RateLimitStorage } from "./interfaces";
import { SetRateLimitDto, RateLimitStatusDto } from "./dto/rate-limit-dto";
import { register } from "../config/metrics";

const DENIED_METRIC = "alian_structure_rate_limit_denied_total";
const ALLOWED_METRIC = "alian_structure_rate_limit_allowed_total";
const ERRORS_METRIC = "alian_structure_rate_limit_errors_total";

@ApiTags("Rate Limiting")
@Controller("rate-limiting")
@Public()
@SkipKyc()
export class RateLimitingController {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  @Get("dashboard")
  @ApiOperation({
    summary: "Rate-limiting dashboard for Grant reviewers",
    description:
      "Aggregated usage and impact metrics for rate-limiting — quotas, " +
      "blocked requests, active strategies, and storage health.",
  })
  @ApiResponse({ status: 200, description: "Dashboard snapshot" })
  async getDashboard(@Req() req: Request) {
    this.assertAuthorized(req);

    const storage = await this.rateLimiter.getStorageHealth();
    const entries = this.rateLimiter.listEntries(500);
    const denied = await this.getMetricValue(DENIED_METRIC);
    const allowed = await this.getMetricValue(ALLOWED_METRIC);
    const errors = await this.getMetricValue(ERRORS_METRIC);

    const deniedByTier: Record<string, number> = {};
    for (const entry of entries) {
      deniedByTier[entry.tier] = (deniedByTier[entry.tier] ?? 0) + 0;
    }

    const allowedByTier: Record<string, number> = {};
    for (const entry of entries) {
      allowedByTier[entry.tier] = (allowedByTier[entry.tier] ?? 0) + 0;
    }

    const strategyCounts: Record<string, number> = {};
    for (const entry of entries) {
      strategyCounts[entry.strategy] =
        (strategyCounts[entry.strategy] ?? 0) + 1;
    }

    return {
      timestamp: new Date().toISOString(),
      storage,
      totals: {
        allowed: allowed,
        denied: denied,
        errors: errors,
        rate:
          allowed + denied > 0
            ? Number(((denied / (allowed + denied)) * 100).toFixed(2))
            : 0,
      },
      byTier: {
        denied: deniedByTier,
        allowed: allowedByTier,
      },
      strategyDistribution: strategyCounts,
      activeEntries: entries.length,
      topEntries: entries.slice(0, 20),
    };
  }

  @Get("status")
  @ApiOperation({
    summary: "Rate-limit status for a tracker/scope",
    description:
      "Returns the current remaining quota and reset time for a given tracker, " +
      "optionally filtered by scope and tier.",
  })
  @ApiResponse({ status: 200, description: "Rate-limit status" })
  async getStatus(
    @Req() req: Request,
    @Query("tracker") tracker?: string,
    @Query("scope") scope?: string,
    @Query("tier") tier?: string,
    @Query("limit") limit?: string,
  ) {
    this.assertAuthorized(req);

    const query = new RateLimitStatusDto();
    query.tracker = tracker;
    query.scope = scope;
    query.tier = tier;
    query.limit = limit ? Number(limit) : 100;

    let entries = this.rateLimiter.listEntries(query.limit);

    if (query.tracker) {
      entries = entries.filter((e) => e.tracker === query.tracker);
    }
    if (query.scope) {
      entries = entries.filter((e) => e.scope === query.scope);
    }
    if (query.tier) {
      entries = entries.filter((e) => e.tier === query.tier);
    }

    return {
      count: entries.length,
      entries,
    };
  }

  @Get("metrics")
  @ApiOperation({
    summary: "Prometheus metrics for rate limiting",
    description:
      "Returns all rate-limiting Prometheus metrics in text-exposition format.",
  })
  @ApiResponse({ status: 200, description: "Prometheus metrics" })
  async getMetrics(@Req() req: Request) {
    this.assertAuthorized(req);
    return register.metrics();
  }

  @Post("entries")
  @ApiOperation({
    summary: "Set a custom rate-limit entry (for testing/bypass)",
    description:
      "Manually create or update a rate-limit configuration for a specific key. " +
      "Useful for Grant reviewers to grant temporary quota adjustments.",
  })
  @ApiResponse({ status: 201, description: "Entry created" })
  async setEntry(@Req() req: Request, @Body() body: SetRateLimitDto) {
    this.assertAuthorized(req);

    const policy = {
      limit: body.limit,
      windowMs: body.windowMs,
      burst: body.burst ?? body.limit,
      strategy: body.strategy,
    };

    const decision = await this.rateLimiter.consume(
      `${body.key}:${body.scope ?? "global"}:${body.tier ?? "free"}`,
      policy,
      `key:${body.key}`,
      body.scope ?? "global",
      body.tier ?? "free",
    );

    return {
      key: body.key,
      policy,
      decision,
      message: "Rate-limit entry configured",
    };
  }

  @Delete("entries/:key")
  @ApiOperation({
    summary: "Reset a rate-limit entry",
    description:
      "Reset (clear) the rate-limit counter for a specific tracker/scope/tier " +
      "combination. Grant reviewers use this to unblock throttled keys.",
  })
  @ApiResponse({ status: 200, description: "Reset result" })
  async resetEntry(
    @Req() req: Request,
    @Param("key") key: string,
    @Query("scope") scope?: string,
    @Query("tier") tier?: string,
  ) {
    this.assertAuthorized(req);

    const rateLimitKey = `${key}:${scope ?? "global"}:${tier ?? "free"}`;
    const reset = await this.rateLimiter.reset(rateLimitKey);

    return {
      key: rateLimitKey,
      reset,
      message: reset
        ? `Rate-limit entry for "${rateLimitKey}" has been reset`
        : `No rate-limit entry found for "${rateLimitKey}"`,
    };
  }

  @Get("storage")
  @ApiOperation({
    summary: "Rate-limit storage health",
    description:
      "Reports whether the rate limiter is using Redis or the in-memory fallback.",
  })
  @ApiResponse({ status: 200, description: "Storage health" })
  async getStorageHealth(@Req() req: Request): Promise<RateLimitStorage> {
    this.assertAuthorized(req);
    return this.rateLimiter.getStorageHealth();
  }

  private async getMetricValue(metricName: string): Promise<number> {
    const metrics = await register.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === metricName);
    if (!metric) return 0;
    return metric.values.reduce((sum, v) => sum + (v.value ?? 0), 0);
  }

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
      throw new UnauthorizedException("Invalid or missing metrics token");
    }
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
