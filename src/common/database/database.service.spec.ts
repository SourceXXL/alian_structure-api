import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { getDataSourceToken } from "@nestjs/typeorm";
import { DatabaseService } from "./database.service";
import { DatabaseConfigService } from "./database.config";
import { SlowQueryLogger } from "./observability/slow-query.logger";

const mockDataSource = {
  isInitialized: true,
  initialize: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
  destroy: jest.fn().mockResolvedValue(undefined),
  logger: undefined,
} as unknown as jest.Mocked<DataSource>;

const makeConfigService = (): Partial<ConfigService> => ({
  get: jest.fn((key: string) => {
    if (key === "NODE_ENV") return "development";
    if (key === "DB_HEALTH_CHECK_INTERVAL_MS") return 30000;
    return undefined;
  }),
});

async function buildService(
  dataSource: Partial<DataSource> = mockDataSource,
): Promise<DatabaseService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DatabaseService,
      { provide: ConfigService, useValue: makeConfigService() },
      {
        provide: DatabaseConfigService,
        useValue: {
          getConnectionOptions: jest.fn(),
          getDataSourceOptions: jest.fn(),
        },
      },
      SlowQueryLogger,
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: "DATABASE_DATA_SOURCE", useValue: dataSource },
    ],
  }).compile();
  return module.get<DatabaseService>(DatabaseService);
}

describe("DatabaseService", () => {
  let service: DatabaseService;
  let dataSource: Partial<DataSource>;

  beforeEach(async () => {
    dataSource = { ...mockDataSource };
    service = await buildService(dataSource);
  });

  describe("onModuleInit", () => {
    it("initializes data source with retry", async () => {
      (dataSource as any).isInitialized = false;
      await service.onModuleInit();
      expect(dataSource.initialize).toHaveBeenCalled();
      expect(dataSource.query).toHaveBeenCalledWith("SELECT 1");
    });

    it("throws when initialization fails after retries", async () => {
      (dataSource as any).isInitialized = false;
      dataSource.initialize = jest.fn().mockRejectedValue(new Error("DB down"));
      dataSource.query = jest.fn().mockRejectedValue(new Error("DB down"));
      await expect(service.onModuleInit()).rejects.toThrow(
        "Unable to establish database connection",
      );
    });
  });

  describe("initializeWithRetry", () => {
    it("retries and succeeds", async () => {
      let attempts = 0;
      dataSource.query = jest.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 3) throw new Error("ECONNREFUSED");
        return Promise.resolve([{ "?column?": 1 }]);
      });
      await service.initializeWithRetry(5, 10);
      expect(attempts).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getHealth", () => {
    it("returns healthy when query succeeds", async () => {
      const health = await service.getHealth();
      expect(health.status).toBe("healthy");
      expect(health.responseTime).toBeGreaterThanOrEqual(0);
    });

    it("returns unhealthy when query fails", async () => {
      dataSource.query = jest.fn().mockRejectedValue(new Error("offline"));
      const health = await service.getHealth();
      expect(health.status).toBe("unhealthy");
      expect(health.error).toContain("offline");
    });
  });

  describe("runMigration", () => {
    it("runs migration successfully", async () => {
      dataSource.createQueryRunner = jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue([]),
        release: jest.fn().mockResolvedValue(undefined),
      });
      await service.runMigration("test_migration");
      expect(dataSource.createQueryRunner).toHaveBeenCalled();
    });
  });

  describe("createTransaction", () => {
    it("commits when callback succeeds", async () => {
      const queryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };
      dataSource.createQueryRunner = jest.fn().mockReturnValue(queryRunner);
      const result = await service.createTransaction(async () => "ok");
      expect(result).toBe("ok");
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it("rolls back when callback throws", async () => {
      const queryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };
      dataSource.createQueryRunner = jest.fn().mockReturnValue(queryRunner);
      await expect(
        service.createTransaction(async () => {
          throw new Error("tx error");
        }),
      ).rejects.toThrow("tx error");
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe("getDataSource", () => {
    it("returns data source when initialized", () => {
      (dataSource as any).isInitialized = true;
      expect(service.getDataSource()).toBe(dataSource);
    });

    it("throws when data source is not initialized", () => {
      (dataSource as any).isInitialized = false;
      expect(() => service.getDataSource()).toThrow(
        "DataSource is not initialized",
      );
    });
  });

  describe("onModuleDestroy", () => {
    it("stops health checks and destroys data source", async () => {
      await service.onModuleDestroy();
      expect(dataSource.destroy).toHaveBeenCalled();
    });
  });
});
