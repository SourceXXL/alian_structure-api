import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { QueryBuilderService } from "./query-builder.service";

const makeQueryBuilder = (): any => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  having: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  rightJoin: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  getOne: jest.fn().mockResolvedValue(null),
  getMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
  query: jest.fn().mockResolvedValue([]),
});

const mockDataSource = {
  getRepository: jest.fn(),
  createQueryRunner: jest.fn(),
};

describe("QueryBuilderService", () => {
  let service: QueryBuilderService<any>;

  beforeEach(async () => {
    jest.clearAllMocks();
    (mockDataSource.getRepository as jest.Mock).mockReturnValue({
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder()),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryBuilderService,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();
    service = module.get<QueryBuilderService<any>>(QueryBuilderService);
  });

  describe("findAll", () => {
    it("applies filters and ordering", async () => {
      const qb = makeQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[{ id: "1" }], 1]);
      (mockDataSource.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      });
      const result = await service.findAll(Object, {
        where: { id: "1" },
        orderBy: { field: "id", direction: "ASC" },
        skip: 0,
        take: 10,
      });
      expect(result.data).toHaveLength(1);
    });

    it("supports joins", async () => {
      const qb = makeQueryBuilder();
      const mockDs = {
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
        createQueryRunner: jest.fn(),
      } as unknown as DataSource;

      const module = await Test.createTestingModule({
        providers: [
          QueryBuilderService,
          { provide: DataSource, useValue: mockDs },
        ],
      }).compile();
      const svc = module.get<QueryBuilderService<any>>(QueryBuilderService);
      await svc.findAll(Object, {
        join: [
          {
            entity: Object,
            alias: "a",
            condition: "a.id = entity.id",
            type: "INNER",
          },
        ],
      });
      expect(qb.innerJoin).toHaveBeenCalled();
    });
  });

  describe("findOne", () => {
    it("returns null when no record found", async () => {
      const qb = makeQueryBuilder();
      qb.getOne.mockResolvedValue(null);
      (mockDataSource.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      });
      const result = await service.findOne(Object, {
        where: { id: "missing" },
      });
      expect(result).toBeNull();
    });
  });

  describe("count", () => {
    it("returns count", async () => {
      const qb = makeQueryBuilder();
      qb.getCount.mockResolvedValue(5);
      (mockDataSource.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      });
      const result = await service.count(Object, {
        where: { id: "1" },
      });
      expect(result).toBe(5);
    });
  });

  describe("rawQuery", () => {
    it("executes raw query", async () => {
      const qb = makeQueryBuilder();
      qb.query.mockResolvedValue([{ id: "1" }]);
      (mockDataSource.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        query: qb.query,
      });
      const result = await service.rawQuery(
        Object,
        "SELECT * FROM entity WHERE id = :1",
        ["1"],
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("transaction", () => {
    it("commits on success", async () => {
      const qb = makeQueryBuilder();
      const mockDs = {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn().mockResolvedValue(undefined),
          startTransaction: jest.fn().mockResolvedValue(undefined),
          commitTransaction: jest.fn().mockResolvedValue(undefined),
          rollbackTransaction: jest.fn().mockResolvedValue(undefined),
          release: jest.fn().mockResolvedValue(undefined),
        }),
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
      } as unknown as DataSource;

      const module = await Test.createTestingModule({
        providers: [
          QueryBuilderService,
          { provide: DataSource, useValue: mockDs },
        ],
      }).compile();
      const svc = module.get<QueryBuilderService<any>>(QueryBuilderService);
      const result = await svc.transaction(async () => "tx-ok");
      expect(result).toBe("tx-ok");
    });

    it("rolls back on error", async () => {
      const mockDs = {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn().mockResolvedValue(undefined),
          startTransaction: jest.fn().mockResolvedValue(undefined),
          commitTransaction: jest.fn().mockResolvedValue(undefined),
          rollbackTransaction: jest.fn().mockResolvedValue(undefined),
          release: jest.fn().mockResolvedValue(undefined),
        }),
        getRepository: jest.fn(),
      } as unknown as DataSource;

      const module = await Test.createTestingModule({
        providers: [
          QueryBuilderService,
          { provide: DataSource, useValue: mockDs },
        ],
      }).compile();
      const svc = module.get<QueryBuilderService<any>>(QueryBuilderService);
      await expect(
        svc.transaction(async () => {
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
    });
  });
});
