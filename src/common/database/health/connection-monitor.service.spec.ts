import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { getDataSourceToken } from "@nestjs/typeorm";
import { ConnectionMonitorService } from "./connection-monitor.service";
import { SlowQueryLogger } from "../observability/slow-query.logger";
import { RetryService } from "../retry/retry.service";

jest.useFakeTimers();

const mockDataSource = {
  isInitialized: true,
  initialize: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
  destroy: jest.fn().mockResolvedValue(undefined),
};

async function buildModule(
  overrides: Partial<any> = {},
): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      ConnectionMonitorService,
      { provide: getDataSourceToken(), useValue: mockDataSource },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) => {
            if (key === "DB_HEALTH_CHECK_INTERVAL_MS") return 30000;
            return undefined;
          }),
        },
      },
      SlowQueryLogger,
      {
        provide: RetryService,
        useValue: { timeout: () => Promise.resolve(undefined) },
      },
      ...(overrides.providers ?? []),
    ],
  }).compile();
}

describe("ConnectionMonitorService", () => {
  afterEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("checkConnection", () => {
    it("returns healthy when query succeeds", async () => {
      const module = await buildModule();
      const service = module.get<ConnectionMonitorService>(
        ConnectionMonitorService,
      );
      const result = await service.checkConnection();
      expect(result.status).toBe("healthy");
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it("returns degraded on transient failure", async () => {
      mockDataSource.query = jest
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));
      const module = await buildModule();
      const service = module.get<ConnectionMonitorService>(
        ConnectionMonitorService,
      );
      const result = await service.checkConnection();
      expect(result.status).toBe("degraded");
      expect(result.consecutiveFailures).toBe(1);
    });

    it("returns unhealthy after repeated transient failures", async () => {
      mockDataSource.query = jest
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));
      const module = await buildModule();
      const service = module.get<ConnectionMonitorService>(
        ConnectionMonitorService,
      );
      await service.checkConnection();
      await service.checkConnection();
      await service.checkConnection();
      const result = await service.checkConnection();
      expect(result.status).toBe("unhealthy");
    });
  });

  describe("reconnect", () => {
    it("reconnects successfully", async () => {
      mockDataSource.initialize = jest.fn().mockResolvedValue(undefined);
      mockDataSource.query = jest.fn().mockResolvedValue([{ "?column?": 1 }]);
      const module = await buildModule();
      const service = module.get<ConnectionMonitorService>(
        ConnectionMonitorService,
      );
      const result = await service.reconnect();
      expect(result).toBe(true);
      expect(mockDataSource.destroy).toHaveBeenCalled();
    });
  });
});
