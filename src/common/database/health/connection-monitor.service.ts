import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { RetryService } from "../retry/retry.service";

export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  responseTime: number;
  activeConnections: number;
  idleConnections: number;
  timestamp: Date;
  error?: string;
  consecutiveFailures: number;
}

@Injectable()
export class ConnectionMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionMonitorService.name);
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;
  private intervalId?: NodeJS.Timeout;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly retryService: RetryService,
  ) {
    this.checkIntervalMs =
      this.configService.get<number>("DB_HEALTH_CHECK_INTERVAL_MS") ?? 30000;
  }

  onModuleInit(): void {
    this.startPeriodicCheck();
  }

  onModuleDestroy(): void {
    this.stopPeriodicCheck();
  }

  async checkConnection(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const result = await Promise.race([
        this.dataSource.query("SELECT 1"),
        this.retryService.timeout(5000).then(() => {
          throw new Error("Connection health check timed out");
        }),
      ]);
      const responseTime = Date.now() - start;
      this.consecutiveFailures = 0;
      const poolManager = (this.dataSource as any).driver?.pool;
      return {
        status: "healthy",
        responseTime,
        activeConnections: poolManager?.size ?? 0,
        idleConnections: poolManager?.available ?? 0,
        timestamp: new Date(),
        consecutiveFailures: 0,
      };
    } catch (error) {
      this.consecutiveFailures++;
      const responseTime = Date.now() - start;
      this.logger.warn(
        `Database health check failed (attempt ${this.consecutiveFailures}/${this.maxConsecutiveFailures})`,
        error,
      );
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.logger.error(
          `Database marked as unhealthy after ${this.consecutiveFailures} consecutive failures`,
        );
      }
      return {
        status:
          this.consecutiveFailures >= this.maxConsecutiveFailures
            ? "unhealthy"
            : "degraded",
        responseTime,
        activeConnections: 0,
        idleConnections: 0,
        timestamp: new Date(),
        error: error.message,
        consecutiveFailures: this.consecutiveFailures,
      };
    }
  }

  async reconnect(): Promise<boolean> {
    this.logger.log("Attempting to reconnect to database");
    try {
      if (this.dataSource?.isInitialized) {
        await this.dataSource.destroy();
      }
      await this.dataSource.initialize();
      await this.dataSource.query("SELECT 1");
      this.consecutiveFailures = 0;
      this.logger.log("Database reconnection successful");
      return true;
    } catch (error) {
      this.logger.error("Database reconnection failed", error);
      return false;
    }
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private startPeriodicCheck(): void {
    this.logger.log(
      `Starting connection monitoring (interval: ${this.checkIntervalMs}ms)`,
    );
    this.intervalId = setInterval(async () => {
      const health = await this.checkConnection();
      if (health.status === "unhealthy") {
        this.logger.error(
          "Database connection is unhealthy, attempting reconnect",
        );
        this.reconnect().then((success) => {
          if (!success) {
            this.logger.error("Automatic reconnection failed");
          }
        });
      } else if (health.status === "degraded") {
        this.logger.warn("Database connection is degraded");
      }
    }, this.checkIntervalMs);
  }

  private stopPeriodicCheck(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
