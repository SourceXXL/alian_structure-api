import { Injectable, OnModuleInit } from "@nestjs/common";
import { logger } from "../../config/logger";
import type { CacheService } from "./cache.service";

/**
 * A warmer function that pre-loads data into the cache.
 *
 * @returns The number of entries warmed.
 */
export type CacheWarmerFn = (cache: CacheService) => Promise<number>;

/**
 * Describes a single warming task.
 */
export interface CacheWarmer {
  /** Human-readable name (used in logs). */
  name: string;

  /** The function that warms the cache. */
  execute: CacheWarmerFn;
}

/**
 * Pre-loads frequently accessed data into the cache on application startup.
 *
 * Register warmers via {@link registerWarmer} or by providing them through
 * the module configuration. All registered warmers run sequentially during
 * {@link onModuleInit} with full error isolation — a failing warmer does not
 * block subsequent warmers.
 */
@Injectable()
export class CacheWarmingService implements OnModuleInit {
  private readonly warmers: CacheWarmer[] = [];

  constructor(private readonly cache: CacheService) {}

  /**
   * Register a warmer for execution at startup.
   */
  registerWarmer(warmer: CacheWarmer): void {
    this.warmers.push(warmer);
  }

  /**
   * Execute all registered warmers sequentially.
   * Called automatically during NestJS module initialisation.
   */
  async onModuleInit(): Promise<void> {
    if (this.warmers.length === 0) {
      logger.info("Cache warming: no warmers registered, skipping");
      return;
    }

    const startTime = Date.now();
    let totalEntries = 0;
    let successCount = 0;
    let failCount = 0;

    logger.info(
      { warmerCount: this.warmers.length },
      "Cache warming started",
    );

    for (const warmer of this.warmers) {
      try {
        const count = await warmer.execute(this.cache);
        totalEntries += count;
        successCount++;
        logger.debug(
          { warmer: warmer.name, entries: count },
          "Cache warmer completed",
        );
      } catch (err) {
        failCount++;
        logger.error(
          { warmer: warmer.name, error: err.message },
          "Cache warmer failed",
        );
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        warmers: this.warmers.length,
        success: successCount,
        failed: failCount,
        totalEntries,
        durationMs,
      },
      "Cache warming completed",
    );
  }

  /**
   * Manually trigger all warmers (e.g. via a scheduled job).
   */
  async warm(): Promise<{ totalEntries: number; durationMs: number }> {
    const start = Date.now();
    let totalEntries = 0;

    for (const warmer of this.warmers) {
      try {
        totalEntries += await warmer.execute(this.cache);
      } catch (err) {
        logger.error(
          { warmer: warmer.name, error: err.message },
          "Cache warmer failed during manual warm",
        );
      }
    }

    return { totalEntries, durationMs: Date.now() - start };
  }

  /** List registered warmer names. */
  listWarmers(): string[] {
    return this.warmers.map((w) => w.name);
  }
}
