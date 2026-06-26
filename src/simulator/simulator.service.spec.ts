import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { SimulatorService } from "./simulator.service";
import {
  Simulation,
  SimulationStatus,
  SupportedChain,
} from "./entities/simulation.entity";

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  delete: jest.fn(),
};

jest.mock("ethers", () => {
  const mockProvider = {
    getBlockNumber: jest.fn().mockResolvedValue(20_000_000),
    getBlock: jest.fn().mockImplementation((n: number) =>
      Promise.resolve({
        number: n,
        timestamp: 1700000000 + n,
        transactions: ["0xabc"],
        prefetchedTransactions: [
          {
            hash: `0x${n}`,
            from: "0xfrom",
            to: "0xto",
            value: BigInt(0),
            gasPrice: BigInt(20_000_000_000),
          },
        ],
      }),
    ),
    getTransactionReceipt: jest.fn().mockResolvedValue({ gasUsed: BigInt(21_000) }),
    getTransaction: jest.fn().mockResolvedValue({
      hash: "0xreplay",
      from: "0xfrom",
      to: "0xto",
      value: BigInt(0),
      gasPrice: BigInt(20_000_000_000),
      blockNumber: 100,
    }),
  };
  return {
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
    formatEther: jest.fn().mockReturnValue("0.001"),
    formatUnits: jest.fn().mockReturnValue("20"),
  };
});

describe("SimulatorService", () => {
  let service: SimulatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulatorService,
        { provide: getRepositoryToken(Simulation), useValue: mockRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("") },
        },
      ],
    }).compile();

    service = module.get<SimulatorService>(SimulatorService);
    jest.clearAllMocks();
  });

  describe("createSimulation", () => {
    it("creates and saves a simulation with explicit block", async () => {
      const dto = {
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 19_000_000,
        blocksToSimulate: 10,
      };
      const expected = { id: "uuid-1", ...dto, status: SimulationStatus.PENDING };
      mockRepo.create.mockReturnValue(expected);
      mockRepo.save.mockResolvedValue(expected);

      const result = await service.createSimulation("user-1", dto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          forkBlockNumber: 19_000_000,
          status: SimulationStatus.PENDING,
        }),
      );
      expect(result).toEqual(expected);
    });

    it("resolves latest block when forkBlockNumber is 0", async () => {
      const dto = {
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 0,
        blocksToSimulate: 5,
      };
      const saved = { id: "uuid-2", ...dto, forkBlockNumber: 20_000_000 };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      await service.createSimulation("user-1", dto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ forkBlockNumber: 20_000_000 }),
      );
    });

    it("stores timeScaleFactor when provided", async () => {
      const dto = {
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 19_000_000,
        blocksToSimulate: 10,
        timeScaleFactor: 5,
      };
      const saved = { id: "uuid-3", ...dto };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      await service.createSimulation("user-1", dto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeScaleFactor: 5 }),
      );
    });

    it("defaults timeScaleFactor to 1 when not provided", async () => {
      const dto = {
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 19_000_000,
        blocksToSimulate: 10,
      };
      mockRepo.create.mockReturnValue({ id: "uuid-4", ...dto });
      mockRepo.save.mockResolvedValue({ id: "uuid-4", ...dto });

      await service.createSimulation("user-1", dto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeScaleFactor: 1 }),
      );
    });
  });

  describe("runSimulation", () => {
    it("throws BadRequest if simulation is already RUNNING", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        status: SimulationStatus.RUNNING,
      } as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);

      await expect(service.runSimulation("s1", "u1", {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequest if simulation is already COMPLETED", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        status: SimulationStatus.COMPLETED,
      } as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);

      await expect(service.runSimulation("s1", "u1", {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws NotFoundException for unknown simulation", async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.runSimulation("bad-id", "u1", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("stores replayTxHashes on update when provided", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        status: SimulationStatus.PENDING,
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 100,
        blocksToSimulate: 1,
      } as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);
      mockRepo.update.mockResolvedValue({});
      mockRepo.findOneBy.mockResolvedValue({ ...sim, status: SimulationStatus.RUNNING });

      await service.runSimulation("s1", "u1", { replayTxHashes: ["0xabc"] });

      expect(mockRepo.update).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ replayTxHashes: ["0xabc"] }),
      );
    });
  });

  describe("findOne", () => {
    it("throws NotFoundException when simulation not found", async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne("missing", "u1")).rejects.toThrow(NotFoundException);
    });

    it("returns simulation when found", async () => {
      const sim = { id: "s1", userId: "u1" } as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);
      const result = await service.findOne("s1", "u1");
      expect(result).toEqual(sim);
    });
  });

  describe("deleteSimulation", () => {
    it("throws BadRequest if simulation is RUNNING", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        status: SimulationStatus.RUNNING,
      } as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);

      await expect(service.deleteSimulation("s1", "u1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("deletes a completed simulation", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        status: SimulationStatus.COMPLETED,
      } as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);
      mockRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteSimulation("s1", "u1");
      expect(mockRepo.delete).toHaveBeenCalledWith("s1");
    });
  });

  describe("getReport", () => {
    it("returns structured report including timeScaleFactor and replayedTxCount", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 19_000_000,
        blocksToSimulate: 100,
        blocksProcessed: 100,
        timeScaleFactor: 10,
        status: SimulationStatus.COMPLETED,
        durationMs: 5000,
        gasReport: { totalGasUsed: 21000 },
        comparisonReport: {},
        agentActions: [{}],
        replayTxHashes: ["0xabc", "0xdef"],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);

      const report = await service.getReport("s1", "u1");
      expect(report).toMatchObject({
        id: "s1",
        status: SimulationStatus.COMPLETED,
        agentActionCount: 1,
        gasReport: { totalGasUsed: 21000 },
        timeScaleFactor: 10,
        replayedTxCount: 2,
      });
    });
  });

  describe("exportReport", () => {
    it("returns full simulation export with agentActions and replayTxHashes", async () => {
      const sim = {
        id: "s1",
        userId: "u1",
        chain: SupportedChain.ETHEREUM,
        forkBlockNumber: 19_000_000,
        blocksToSimulate: 50,
        blocksProcessed: 50,
        timeScaleFactor: 1,
        status: SimulationStatus.COMPLETED,
        durationMs: 3000,
        gasReport: { totalGasUsed: 42000 },
        comparisonReport: { simulatedTxCount: 2 },
        agentActions: [{ txHash: "0x1" }, { txHash: "0x2" }],
        replayTxHashes: ["0xreplay"],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Simulation;
      mockRepo.findOne.mockResolvedValue(sim);

      const exported = await service.exportReport("s1", "u1");

      expect(exported).toMatchObject({
        simulation: expect.objectContaining({ id: "s1", timeScaleFactor: 1 }),
        gasReport: { totalGasUsed: 42000 },
        comparisonReport: { simulatedTxCount: 2 },
        agentActions: [{ txHash: "0x1" }, { txHash: "0x2" }],
        replayTxHashes: ["0xreplay"],
      });
      expect((exported as any).exportedAt).toBeDefined();
    });

    it("throws NotFoundException for unknown simulation", async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.exportReport("missing", "u1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
