import { Test, TestingModule } from "@nestjs/testing";
import {
  DataSource,
  Repository,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from "typeorm";
import { BaseRepository } from "../repositories/base.repository";
import { BaseEntity } from "typeorm";

@Entity()
class TestEntity extends BaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @CreateDateColumn()
  createdAt: Date;
}

class ConcreteTestRepository extends BaseRepository<TestEntity> {
  constructor(dataSource: DataSource) {
    super(dataSource, TestEntity);
  }
}

describe("BaseRepository", () => {
  let dataSource: jest.Mocked<DataSource>;
  let qb: any;
  let repository: jest.Mocked<Repository<TestEntity>>;
  let repo: ConcreteTestRepository;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn(),
      findMany: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      count: jest.fn(),
      exists: jest.fn(),
    } as unknown as jest.Mocked<Repository<TestEntity>>;

    dataSource = {
      getRepository: jest.fn().mockReturnValue(repository),
      createQueryRunner: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    repo = new ConcreteTestRepository(dataSource as any);
  });

  describe("findById", () => {
    it("returns entity by id", async () => {
      repository.findOne.mockResolvedValue({ id: "1", name: "test" } as any);
      const result = await repo.findById("1");
      expect(result?.id).toBe("1");
    });

    it("returns null when not found", async () => {
      repository.findOne.mockResolvedValue(null);
      const result = await repo.findById("1");
      expect(result).toBeNull();
    });
  });

  describe("findAll", () => {
    it("applies skip and take", async () => {
      qb.getMany.mockResolvedValue([{ id: "1" }]);
      const result = await repo.findAll({ skip: 0, take: 10 });
      expect(result).toHaveLength(1);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
    });
  });

  describe("create", () => {
    it("creates and returns entity", async () => {
      repository.create = jest
        .fn()
        .mockReturnValue({ id: "1", name: "new" } as any);
      repository.save = jest
        .fn()
        .mockResolvedValue({ id: "1", name: "new" } as any);
      const result = await repo.create({ name: "new" } as any);
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("updates and returns entity", async () => {
      repository.update.mockResolvedValue({ affected: 1 } as any);
      repository.findOne.mockResolvedValue({ id: "1", name: "updated" } as any);
      const result = await repo.update("1", { name: "updated" } as any);
      expect(result?.name).toBe("updated");
    });
  });

  describe("delete", () => {
    it("deletes and returns true", async () => {
      repository.delete.mockResolvedValue({ affected: 1 } as any);
      const result = await repo.delete("1");
      expect(result).toBe(true);
    });
  });

  describe("count", () => {
    it("returns count", async () => {
      repository.count = jest.fn().mockResolvedValue(5);
      const result = await repo.count({ name: "test" } as any);
      expect(result).toBe(5);
    });
  });

  describe("exists", () => {
    it("returns existence boolean", async () => {
      repository.exists = jest.fn().mockResolvedValue(true);
      const result = await repo.exists("1");
      expect(result).toBe(true);
    });
  });
});
