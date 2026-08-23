import { Injectable, Logger } from "@nestjs/common";

export interface SlowQueryEntry {
  query: string;
  executionTime: number;
  timestamp: Date;
  parameters?: Record<string, any>;
}

@Injectable()
export class SlowQueryLogger {
  private readonly logger = new Logger(SlowQueryLogger.name);
  private readonly slowQueryThresholdMs: number;
  private readonly maxStoredQueries: number;
  private recentQueries: SlowQueryEntry[] = [];

  constructor() {
    this.slowQueryThresholdMs = parseInt(
      process.env.SLOW_QUERY_THRESHOLD_MS ?? "1000",
      10,
    );
    this.maxStoredQueries = parseInt(
      process.env.MAX_STORED_SLOW_QUERIES ?? "100",
      10,
    );
  }

  logQuery(message: string): void {
    if (message.toLowerCase().includes("slow query")) {
      this.logger.warn(`Slow query detected: ${message}`);
    }
  }

  logSlowQuery(time: number, query: string): void {
    if (time >= this.slowQueryThresholdMs) {
      const entry: SlowQueryEntry = {
        query,
        executionTime: time,
        timestamp: new Date(),
      };
      this.recentQueries.push(entry);
      if (this.recentQueries.length > this.maxStoredQueries) {
        this.recentQueries.shift();
      }
      this.logger.warn(
        `Slow query (${time}ms): ${query.substring(0, 500)}${query.length > 500 ? "..." : ""}`,
      );
    }
  }

  getSlowQueries(): SlowQueryEntry[] {
    return [...this.recentQueries];
  }

  getTopSlowQueries(limit = 10): SlowQueryEntry[] {
    return [...this.recentQueries]
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, limit);
  }

  clearSlowQueries(): void {
    this.recentQueries = [];
  }

  getStats(): {
    total: number;
    avgExecutionTime: number;
    maxExecutionTime: number;
  } {
    if (this.recentQueries.length === 0) {
      return { total: 0, avgExecutionTime: 0, maxExecutionTime: 0 };
    }
    const total = this.recentQueries.length;
    const avgExecutionTime =
      this.recentQueries.reduce((sum, q) => sum + q.executionTime, 0) / total;
    const maxExecutionTime = Math.max(
      ...this.recentQueries.map((q) => q.executionTime),
    );
    return { total, avgExecutionTime, maxExecutionTime };
  }
}
