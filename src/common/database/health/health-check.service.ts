import { Injectable, Logger, Req, Res, Get, HttpStatus } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ConnectionMonitorService } from "../health/connection-monitor.service";

export interface HealthCheckResponse {
  status: "ok" | "degraded" | "error";
  database: {
    status: "up" | "down";
    responseTime?: number;
    error?: string;
  };
  timestamp: string;
  uptime: number;
}

export interface HealthCheckOptions {
  timeoutMs?: number;
  slowThresholdMs?: number;
}

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  private readonly defaultTimeout: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly monitor: ConnectionMonitorService,
  ) {
    this.defaultTimeout = 5000;
  }

  async check(options: HealthCheckOptions = {}): Promise<HealthCheckResponse> {
    const start = Date.now();
    try {
      const result = await Promise.race([
        this.dataSource.query("SELECT 1"),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Health check timed out after ${options.timeoutMs ?? this.defaultTimeout}ms`,
                ),
              ),
            options.timeoutMs ?? this.defaultTimeout,
          ),
        ),
      ]);
      const responseTime = Date.now() - start;
      return {
        status: "ok",
        database: {
          status: "up",
          responseTime,
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      };
    } catch (error) {
      return {
        status: "error",
        database: {
          status: "down",
          error: error.message,
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      };
    }
  }

  async getDetailedHealth(): Promise<any> {
    const check = await this.check();
    const monitorHealth = await this.monitor.checkConnection();
    return {
      ...check,
      connectionPool: {
        activeConnections: monitorHealth.activeConnections,
        idleConnections: monitorHealth.idleConnections,
        consecutiveFailures: monitorHealth.consecutiveFailures,
      },
    };
  }
}
