import { Injectable } from "@nestjs/common";
import client from "prom-client";
import { register } from "../../config/metrics";

// ---------------------------------------------------------------------------
// Prometheus metrics (idempotent — safe to call multiple times)
// ---------------------------------------------------------------------------

function getOrCreateCounter(
  config: client.CounterConfiguration<string>,
): client.Counter {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ ...config, registers: [register] });
}

function getOrCreateGauge(
  config: client.GaugeConfiguration<string>,
): client.Gauge {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as client.Gauge;
  return new client.Gauge({ ...config, registers: [register] });
}

const PREFIX = "alian_structure_";

const cacheHitsTotal = getOrCreateCounter({
  name: `${PREFIX}cache_hits_total`,
  help: "Total number of cache hits",
  labelNames: ["namespace"],
});

const cacheMissesTotal = getOrCreateCounter({
  name: `${PREFIX}cache_misses_total`,
  help: "Total number of cache misses",
  labelNames: ["namespace"],
});

const cacheSetsTotal = getOrCreateCounter({
  name: `${PREFIX}cache_sets_total`,
  help: "Total number of cache set operations",
  labelNames: ["namespace"],
});

const cacheDeletesTotal = getOrCreateCounter({
  name: `${PREFIX}cache_deletes_total`,
  help: "Total number of cache delete operations",
  labelNames: ["namespace"],
});

const cacheMemoryEntries = getOrCreateGauge({
  name: `${PREFIX}cache_memory_entries`,
  help: "Current number of entries in the in-memory cache",
});

const cacheMemoryBytes = getOrCreateGauge({
  name: `${PREFIX}cache_memory_bytes`,
  help: "Estimated memory usage of the in-memory cache in bytes",
});

const cacheErrorsTotal = getOrCreateCounter({
  name: `${PREFIX}cache_errors_total`,
  help: "Total number of cache operation errors",
  labelNames: ["operation"],
});

// ---------------------------------------------------------------------------
// Stats service
// ---------------------------------------------------------------------------

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  sets: number;
  deletes: number;
  memoryEntries: number;
  memoryBytes: number;
  errors: number;
  /** Per-namespace hit/miss breakdown. */
  namespaces: Record<string, { hits: number; misses: number }>;
}

/**
 * Tracks cache hit rates, memory usage, and exposes Prometheus metrics for
 * monitoring and alerting.
 */
@Injectable()
export class CacheStatsService {
  private totalHits = 0;
  private totalMisses = 0;
  private totalSets = 0;
  private totalDeletes = 0;
  private totalErrors = 0;

  private namespaceHits = new Map<string, number>();
  private namespaceMisses = new Map<string, number>();

  // -- recording helpers (called by CacheService) --

  recordHit(namespace: string): void {
    this.totalHits++;
    this.namespaceHits.set(
      namespace,
      (this.namespaceHits.get(namespace) ?? 0) + 1,
    );
    cacheHitsTotal.inc({ namespace });
  }

  recordMiss(namespace: string): void {
    this.totalMisses++;
    this.namespaceMisses.set(
      namespace,
      (this.namespaceMisses.get(namespace) ?? 0) + 1,
    );
    cacheMissesTotal.inc({ namespace });
  }

  recordSet(namespace: string): void {
    this.totalSets++;
    cacheSetsTotal.inc({ namespace });
  }

  recordDelete(namespace: string): void {
    this.totalDeletes++;
    cacheDeletesTotal.inc({ namespace });
  }

  recordError(operation: string): void {
    this.totalErrors++;
    cacheErrorsTotal.inc({ operation });
  }

  // -- gauges (called on snapshot) --

  updateMemoryStats(entries: number, estimatedBytes: number): void {
    cacheMemoryEntries.set(entries);
    cacheMemoryBytes.set(estimatedBytes);
  }

  // -- snapshot --

  /**
   * Return a snapshot of the current cache statistics.
   */
  getStats(): CacheStats {
    const total = this.totalHits + this.totalMisses;
    return {
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      sets: this.totalSets,
      deletes: this.totalDeletes,
      memoryEntries: 0, // caller should update via updateMemoryStats
      memoryBytes: 0,
      errors: this.totalErrors,
      namespaces: this.buildNamespaceStats(),
    };
  }

  /** Reset all counters to zero. */
  reset(): void {
    this.totalHits = 0;
    this.totalMisses = 0;
    this.totalSets = 0;
    this.totalDeletes = 0;
    this.totalErrors = 0;
    this.namespaceHits.clear();
    this.namespaceMisses.clear();
  }

  // -- private --

  private buildNamespaceStats(): Record<
    string,
    { hits: number; misses: number }
  > {
    const all = new Set([
      ...this.namespaceHits.keys(),
      ...this.namespaceMisses.keys(),
    ]);
    const result: Record<string, { hits: number; misses: number }> = {};
    for (const ns of all) {
      result[ns] = {
        hits: this.namespaceHits.get(ns) ?? 0,
        misses: this.namespaceMisses.get(ns) ?? 0,
      };
    }
    return result;
  }
}
