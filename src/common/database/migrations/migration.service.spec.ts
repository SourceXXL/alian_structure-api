import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { MigrationService } from "./migration.service";

const createQueryRunner = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
});

function makeMockDataSource(): any {
  return {
    query: jest.fn(),
    createQueryRunner: jest.fn().mockReturnValue(createQueryRunner()),
  };
}

async function buildModule(
  dataSource: any = makeMockDataSource(),
): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      MigrationService,
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();
}

describe("MigrationService", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("register and status", () => {
    it("tracks registered migrations", async () => {
      const dataSource = makeMockDataSource();
      dataSource.query
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([]);
      const module = await buildModule(dataSource);
      const service = module.get<MigrationService>(MigrationService);
      service.register({
        name: "001_init",
        up: jest.fn(),
        down: jest.fn(),
      });
      const status = await service.getStatus(dataSource);
      expect(status.total).toBe(1);
    });
  });

  describe("runPending", () => {
    it("executes pending migrations", async () => {
      const dataSource = makeMockDataSource();
      dataSource.query
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([]);
      const module = await buildModule(dataSource);
      const service = module.get<MigrationService>(MigrationService);
      service.register({
        name: "001_init",
        up: jest.fn(),
        down: jest.fn(),
      });

      await service.runPending(dataSource);
      const queryRunner = dataSource.createQueryRunner();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe("revertLast", () => {
    it("reverts the last applied migration", async () => {
      const dataSource = makeMockDataSource();
      dataSource.query
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{ name: "001_init" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const module = await buildModule(dataSource);
      const service = module.get<MigrationService>(MigrationService);
      service.register({
        name: "001_init",
        up: jest.fn(),
        down: jest.fn(),
      });

      await service.revertLast(dataSource);
      const queryRunner = dataSource.createQueryRunner();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
    });
  });
});
