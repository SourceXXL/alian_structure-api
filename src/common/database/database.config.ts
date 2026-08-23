import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, DataSourceOptions } from "typeorm";

export interface ConnectionPoolConfig {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  acquireTimeoutMillis?: number;
  createTimeoutMillis?: number;
  destroyTimeoutMillis?: number;
  reapIntervalMillis?: number;
  createRetryIntervalMillis?: number;
}

export interface DatabaseConfig {
  type: "postgres" | "sqlite";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  url?: string;
  pool: ConnectionPoolConfig;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  synchronize?: boolean;
  logging?: boolean | string[];
  migrations?: string[];
  entities: string[];
}

@Injectable()
export class DatabaseConfigService {
  private readonly logger = new Logger(DatabaseConfigService.name);
  private readonly environment: string;

  constructor(private readonly configService: ConfigService) {
    this.environment =
      this.configService.get<string>("NODE_ENV") ?? "development";
  }

  getConnectionOptions(): DatabaseConfig {
    const configs: Record<string, () => DatabaseConfig> = {
      development: () => this.getDevelopmentConfig(),
      staging: () => this.getStagingConfig(),
      production: () => this.getProductionConfig(),
      test: () => this.getTestConfig(),
    };

    const envConfig = configs[this.environment] || configs.development;
    return envConfig();
  }

  getDataSourceOptions(): DataSourceOptions {
    const config = this.getConnectionOptions();
    return {
      type: config.type,
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      database: config.database,
      url: config.url,
      entities: config.entities,
      synchronize: config.synchronize,
      logging: this.getLoggingLevel(config.logging),
      pool: config.pool,
      ssl: config.ssl,
      migrations: config.migrations,
    } as DataSourceOptions;
  }

  private getLoggingLevel(logging?: boolean | string[]): boolean | string[] {
    if (this.environment === "production") {
      return ["error", "warn", "migration", "query-slow"];
    }
    if (this.environment === "development") {
      return ["query", "schema", "error", "warn", "migration"];
    }
    return logging ?? true;
  }

  private getDevelopmentConfig(): DatabaseConfig {
    const databaseUrl = this.configService.get<string>("DATABASE_URL");
    if (databaseUrl) {
      return {
        type: "postgres",
        url: databaseUrl,
        database: "alian-structure",
        pool: {
          max: 10,
          min: 2,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
          acquireTimeoutMillis: 10000,
          createTimeoutMillis: 5000,
          destroyTimeoutMillis: 5000,
          reapIntervalMillis: 10000,
          createRetryIntervalMillis: 200,
        },
        ssl: false,
        synchronize: false,
        logging: false,
        migrations: ["src/migrations/**/*.ts"],
        entities: ["src/common/database/entities/**/*.entity.ts"],
      };
    }
    return {
      type: "sqlite",
      database: "data/dev.db",
      pool: {
        max: 5,
        min: 1,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      },
      synchronize: true,
      logging: false,
      migrations: [],
      entities: ["src/common/database/entities/**/*.entity.ts"],
    };
  }

  private getStagingConfig(): DatabaseConfig {
    const databaseUrl = this.configService.get<string>("DATABASE_URL");
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for staging environment");
    }
    return {
      type: "postgres",
      url: databaseUrl,
      database: "alian-structure-staging",
      pool: {
        max: 20,
        min: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        acquireTimeoutMillis: 8000,
        createTimeoutMillis: 5000,
        destroyTimeoutMillis: 5000,
        reapIntervalMillis: 5000,
        createRetryIntervalMillis: 200,
      },
      ssl: { rejectUnauthorized: false },
      synchronize: false,
      logging: true,
      migrations: ["src/migrations/**/*.ts"],
      entities: ["src/common/database/entities/**/*.entity.ts"],
    };
  }

  private getProductionConfig(): DatabaseConfig {
    const databaseUrl = this.configService.get<string>("DATABASE_URL");
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for production environment");
    }
    return {
      type: "postgres",
      url: databaseUrl,
      database: "alian-structure-production",
      pool: {
        max: 50,
        min: 10,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 10000,
        acquireTimeoutMillis: 15000,
        createTimeoutMillis: 10000,
        destroyTimeoutMillis: 10000,
        reapIntervalMillis: 5000,
        createRetryIntervalMillis: 1000,
      },
      ssl: { rejectUnauthorized: true },
      synchronize: false,
      logging: true,
      migrations: ["dist/migrations/**/*.js"],
      entities: ["dist/common/database/entities/**/*.entity.js"],
    };
  }

  private getTestConfig(): DatabaseConfig {
    return {
      type: "sqlite",
      database: ":memory:",
      pool: {
        max: 5,
        min: 1,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      },
      synchronize: true,
      logging: false,
      migrations: [],
      entities: ["src/common/database/entities/**/*.entity.ts"],
    };
  }
}
