import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, DataSourceOptions } from "typeorm";
import { retry, RetryStrategy, ConnectionError } from "./retry/retry.service";
import { DatabaseConfigService } from "./database.config";
import { SlowQueryLogger } from "./observability/slow-query.logger";

const DATABASE_DATA_SOURCE = "DATABASE_DATA_SOURCE";

export interface ConnectionHealth {
  status: "healthy" | "degraded" | "unhealthy";
  responseTime: number;
  activeConnections: number;
  idleConnections: number;
  lastCheck: Date;
  error?: string;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly dataSource: DataSource;
  private monitorInterval?: NodeJS.Timeout;
  private readonly healthCheckIntervalMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly config: DatabaseConfigService,
    private readonly slowQueryLogger: SlowQueryLogger,
    @Inject(DATABASE_DATA_SOURCE) dataSource: DataSource,
  ) {
    this.dataSource = dataSource;
    this.healthCheckIntervalMs =
      this.configService.get<number>("DB_HEALTH_CHECK_INTERVAL_MS") ?? 30000;
  }

  async onModuleInit(): Promise<void> {
    await this.initializeWithRetry();
    this.startPeriodicHealthCheck();
    this.setupQueryLogging();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopPeriodicHealthCheck();
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  async initializeWithRetry(
    maxRetries = 5,
    baseDelay = 1000,
    maxDelay = 30000,
  ): Promise<void> {
    this.logger.log(
      `Initializing database connection (max retries: ${maxRetries})`,
    );

    try {
      await retry(
        async () => {
          if (!this.dataSource?.isInitialized) {
            await this.dataSource.initialize();
          }
          await this.dataSource?.query("SELECT 1");
        },
        {
          maxRetries,
          baseDelay,
          maxDelay,
          strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
          shouldRetry: (error) => this.isTransientError(error),
        },
      );
      this.logger.log("Database connection initialized successfully");
    } catch (error) {
      this.logger.error(
        `Database connection failed after ${maxRetries} retries`,
        error,
      );
      throw new Error(
        `Unable to establish database connection: ${error.message}`,
      );
    }
  }

  async getHealth(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      const result = await this.dataSource.query("SELECT 1");
      const poolManager = (this.dataSource as any).driver?.pool;
      return {
        status: "healthy",
        responseTime: Date.now() - start,
        activeConnections: poolManager?.size ?? 0,
        idleConnections: poolManager?.available ?? 0,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        responseTime: Date.now() - start,
        activeConnections: 0,
        idleConnections: 0,
        lastCheck: new Date(),
        error: error.message,
      };
    }
  }

  async runMigration(name: string): Promise<void> {
    this.logger.log(`Running migration: ${name}`);
    try {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        await queryRunner.query(`SELECT * FROM ${name}`);
        await queryRunner.commitTransaction();
        this.logger.log(`Migration ${name} completed successfully`);
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(`Migration ${name} failed`, error);
      throw error;
    }
  }

  async createTransaction<T>(fn: (queryRunner: any) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        const result = await fn(queryRunner);
        await queryRunner.commitTransaction();
        return result;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      }
    } finally {
      await queryRunner.release();
    }
  }

  getDataSource(): DataSource {
    if (!this.dataSource?.isInitialized) {
      throw new Error("DataSource is not initialized");
    }
    return this.dataSource;
  }

  async shutdown(): Promise<void> {
    this.logger.log("Shutting down database service");
    this.onModuleDestroy();
  }

  private startPeriodicHealthCheck(): void {
    this.logger.log(
      `Starting periodic health checks (interval: ${this.healthCheckIntervalMs}ms)`,
    );
    this.monitorInterval = setInterval(async () => {
      const health = await this.getHealth();
      if (health.status !== "healthy") {
        this.logger.warn(`Database health check failed: ${health.error}`);
      }
    }, this.healthCheckIntervalMs);
  }

  private stopPeriodicHealthCheck(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  private setupQueryLogging(): void {
    const logger = this.dataSource.logger as any;
    if (logger && this.slowQueryLogger) {
      this.dataSource.logger = {
        log: (message: string) => this.slowQueryLogger.logQuery(message),
        logSlow: (time: number, query: string) =>
          this.slowQueryLogger.logSlowQuery(time, query),
        logSchema: (message: string) => this.logger.debug(message),
        logMigration: (message: string) => this.logger.debug(message),
        ...(logger.log ? { log: logger.log } : {}),
        ...(logger.logSchema ? { logSchema: logger.logSchema } : {}),
        ...(logger.logMigration ? { logMigration: logger.logMigration } : {}),
        ...(logger.logError ? { logError: logger.logError } : {}),
        ...(logger.logQuery ? { logQuery: logger.logQuery } : {}),
        ...(logger.logQuerySlow ? { logQuerySlow: logger.logQuerySlow } : {}),
      } as any;
    }
  }

  private isTransientError(error: any): boolean {
    if (!error) return false;
    const transientCodes = [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "ETIMEDOUT",
    ];
    const message = error.message ?? error.code ?? "";
    return transientCodes.some((code) => message.includes(code));
  }
}
