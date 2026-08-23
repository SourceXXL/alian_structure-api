import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AuditLogRepository } from "./audit-log.repository";
import { AuditLog, AuditAction, LogLevel } from "../entities/audit-log.entity";

const mockDataSource = {
  getRepository: jest.fn(),
  createQueryRunner: jest.fn(),
} as any;

describe("AuditLogRepository", () => {
  let repo: AuditLogRepository;
  let qb: any;
  let repository: any;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };

    repository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };

    (mockDataSource.getRepository as jest.Mock).mockReturnValue(repository);
    repo = new AuditLogRepository(mockDataSource);
  });

  describe("createLog", () => {
    it("creates audit log with defaults", async () => {
      repository.save = jest.fn().mockResolvedValue({
        id: "1",
        action: AuditAction.ACCESS,
        level: LogLevel.INFO,
      });
      const result = await repo.createLog({
        action: AuditAction.ACCESS,
        ipAddress: "127.0.0.1",
      });
      expect(repository.save).toHaveBeenCalled();
      expect(result.action).toBe(AuditAction.ACCESS);
    });
  });

  describe("findByUserId", () => {
    it("queries by userId", async () => {
      qb.getMany.mockResolvedValue([{ id: "1" }]);
      const result = await repo.findByUserId("user-1");
      expect(qb.andWhere).toHaveBeenCalledWith("entity.userId = :userId", {
        userId: "user-1",
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("findByAction", () => {
    it("queries by action", async () => {
      qb.getMany.mockResolvedValue([{ id: "1" }]);
      const result = await repo.findByAction(AuditAction.CREATE);
      expect(qb.andWhere).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe("findByDateRange", () => {
    it("queries by date range", async () => {
      qb.getMany.mockResolvedValue([{ id: "1" }]);
      const result = await repo.findByDateRange(
        new Date("2024-01-01"),
        new Date("2024-12-31"),
      );
      expect(qb.andWhere).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
    });
  });

  describe("countByAction", () => {
    it("counts logs by action", async () => {
      repository.count = jest.fn().mockResolvedValue(10);
      const result = await repo.countByAction(AuditAction.LOGIN);
      expect(result).toBe(10);
    });
  });

  describe("deleteOldLogs", () => {
    it("deletes old logs", async () => {
      const q = repository.createQueryBuilder();
      (q as any).delete = jest.fn().mockReturnThis();
      (q as any).from = jest.fn().mockReturnThis();
      (q as any).where = jest.fn().mockReturnThis();
      (q as any).execute = jest.fn().mockResolvedValue({ affected: 5 });
      const result = await repo.deleteOldLogs(new Date("2020-01-01"));
      expect(result).toBe(5);
    });
  });
});
