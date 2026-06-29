import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { PortfolioService } from "../../src/investment/portfolio/services/portfolio.service";
import { Portfolio } from "../../src/investment/portfolio/entities/portfolio.entity";
import {
  PortfolioAsset,
  Chain,
  AssetType,
} from "../../src/investment/portfolio/entities/portfolio-asset.entity";
import { OptimizationHistory } from "../../src/investment/portfolio/entities/optimization-history.entity";
import { RiskProfile } from "../../src/investment/portfolio/entities/risk-profile.entity";
import { CreatePortfolioDto } from "../../src/investment/portfolio/dto/portfolio.dto";
import { OptimizationMethod } from "../../src/investment/portfolio/entities/optimization-history.entity";
import {
  AddHoldingDto,
  UpdateHoldingDto,
} from "../../src/investment/portfolio/dto/portfolio-asset.dto";

describe("PortfolioService", () => {
  let service: PortfolioService;
  let portfolioRepository: any;
  let assetRepository: any;
  let optimizationRepository: any;
  let riskProfileRepository: any;

  const mockPortfolio = {
    id: "test-portfolio-1",
    userId: "test-user-1",
    name: "Test Portfolio",
    type: "custom",
    status: "active",
    totalValue: 100000,
    currentAllocation: { AAPL: 30, MSFT: 70 },
    targetAllocation: null,
    initialAllocation: {},
    allocationStrategy: "manual",
    autoRebalanceEnabled: false,
    rebalanceThreshold: 5,
    assets: [],
    deletedAt: null,
    save: jest.fn(),
  };

  const mockAsset = {
    id: "asset-1",
    ticker: "AAPL",
    name: "Apple",
    chain: Chain.OTHER,
    quantity: 100,
    currentPrice: 150,
    value: 15000,
    allocationPercentage: 15,
    portfolioId: "test-portfolio-1",
    save: jest.fn(),
  };

  const mockOptimization = {
    id: "opt-1",
    portfolioId: "test-portfolio-1",
    method: OptimizationMethod.MEAN_VARIANCE,
    status: "completed",
    suggestedAllocation: { AAPL: 40, MSFT: 60 },
    expectedReturn: 0.08,
    expectedVolatility: 0.15,
    expectedSharpeRatio: 0.5,
    improvementScore: 10,
    currentAllocation: mockPortfolio.currentAllocation,
    save: jest.fn(),
  };

  beforeEach(async () => {
    portfolioRepository = {
      create: jest.fn().mockReturnValue(mockPortfolio),
      save: jest.fn().mockResolvedValue(mockPortfolio),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([mockPortfolio]),
      delete: jest.fn(),
    };

    assetRepository = {
      create: jest.fn().mockReturnValue(mockAsset),
      save: jest.fn().mockResolvedValue(mockAsset),
      find: jest.fn().mockResolvedValue([mockAsset]),
      findOne: jest.fn(),
    };

    optimizationRepository = {
      create: jest.fn().mockReturnValue(mockOptimization),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    riskProfileRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: getRepositoryToken(Portfolio),
          useValue: portfolioRepository,
        },
        {
          provide: getRepositoryToken(PortfolioAsset),
          useValue: assetRepository,
        },
        {
          provide: getRepositoryToken(OptimizationHistory),
          useValue: optimizationRepository,
        },
        {
          provide: getRepositoryToken(RiskProfile),
          useValue: riskProfileRepository,
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createPortfolio", () => {
    it("should create a new portfolio", async () => {
      portfolioRepository.findOne.mockResolvedValue(null);

      const dto: CreatePortfolioDto = {
        name: "Test Portfolio",
        type: "custom",
      };

      const result = await service.createPortfolio("test-user-1", dto);

      expect(portfolioRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: dto.name,
          userId: "test-user-1",
          type: "custom",
          status: "active",
        }),
      );
      expect(portfolioRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockPortfolio);
    });

    it("should throw if portfolio name already exists", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const dto: CreatePortfolioDto = {
        name: "Test Portfolio",
      };

      await expect(
        service.createPortfolio("test-user-1", dto),
      ).rejects.toThrow("Portfolio with this name already exists");
    });

    it("should throw for empty name", async () => {
      const dto: CreatePortfolioDto = {
        name: "   ",
      };

      await expect(
        service.createPortfolio("test-user-1", dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getPortfolio", () => {
    it("should return a portfolio by ID", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const result = await service.getPortfolio("test-portfolio-1");

      expect(portfolioRepository.findOne).toHaveBeenCalledWith({
        where: { id: "test-portfolio-1" },
        relations: expect.any(Array),
      });
      expect(result).toEqual(mockPortfolio);
    });

    it("should throw NotFoundException if portfolio not found", async () => {
      portfolioRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getPortfolio("non-existent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if portfolio is deleted", async () => {
      const deletedPortfolio = { ...mockPortfolio, deletedAt: new Date() };
      portfolioRepository.findOne.mockResolvedValue(deletedPortfolio);

      await expect(
        service.getPortfolio("test-portfolio-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getUserPortfolios", () => {
    it("should return all portfolios for a user", async () => {
      const result = await service.getUserPortfolios("test-user-1");

      expect(portfolioRepository.find).toHaveBeenCalledWith({
        where: { userId: "test-user-1" },
        relations: expect.any(Array),
        order: expect.any(Object),
      });
      expect(result).toEqual([mockPortfolio]);
    });
  });

  describe("updatePortfolio", () => {
    it("should update portfolio properties", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const updateDto = {
        name: "Updated Portfolio",
        description: "Updated description",
      };

      const result = await service.updatePortfolio(
        "test-portfolio-1",
        updateDto,
      );

      expect(portfolioRepository.save).toHaveBeenCalled();
      expect(result.name).toBe("Updated Portfolio");
    });

    it("should archive portfolio when status is ARCHIVED", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const updateDto = {
        status: "archived",
      };

      const result = await service.updatePortfolio(
        "test-portfolio-1",
        updateDto,
      );

      expect(result.status).toBe("archived");
      expect(result.deletedAt).toBeDefined();
    });

    it("should validate allocation percentages", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const updateDto = {
        currentAllocation: { AAPL: 60, MSFT: 50 },
      };

      await expect(
        service.updatePortfolio("test-portfolio-1", updateDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("deletePortfolio", () => {
    it("should soft delete portfolio", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      await service.deletePortfolio("test-portfolio-1");

      expect(mockPortfolio.status).toBe("archived");
      expect(mockPortfolio.deletedAt).toBeDefined();
      expect(portfolioRepository.save).toHaveBeenCalled();
    });

    it("should throw NotFoundException for deleted portfolio", async () => {
      const deletedPortfolio = { ...mockPortfolio, deletedAt: new Date() };
      portfolioRepository.findOne.mockResolvedValue(deletedPortfolio);

      await expect(
        service.deletePortfolio("test-portfolio-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("restorePortfolio", () => {
    it("should restore archived portfolio", async () => {
      const archivedPortfolio = {
        ...mockPortfolio,
        status: "archived",
        deletedAt: new Date(),
      };
      portfolioRepository.findOne.mockResolvedValue(archivedPortfolio);

      const result = await service.restorePortfolio("test-portfolio-1");

      expect(result.status).toBe("active");
      expect(result.deletedAt).toBeNull();
      expect(portfolioRepository.save).toHaveBeenCalled();
    });

    it("should throw NotFoundException when restoring non-archived portfolio", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      await expect(
        service.restorePortfolio("test-portfolio-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("addAsset", () => {
    it("should add an asset to portfolio", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.findOne.mockResolvedValue(null);

      const result = await service.addAsset(
        "test-portfolio-1",
        "AAPL",
        "Apple",
        100,
        150,
        0,
      );

      expect(assetRepository.create).toHaveBeenCalled();
      expect(assetRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockAsset);
    });

    it("should throw for invalid quantity", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      await expect(
        service.addAsset("test-portfolio-1", "AAPL", "Apple", -10, 150, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for negative price", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      await expect(
        service.addAsset("test-portfolio-1", "AAPL", "Apple", 100, -150, 0),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("runOptimization", () => {
    it("should run portfolio optimization", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.find.mockResolvedValue([mockAsset]);
      optimizationRepository.create.mockReturnValue({
        ...mockOptimization,
        status: "in_progress",
        save: jest.fn(),
      });
      optimizationRepository.save
        .mockResolvedValueOnce({
          ...mockOptimization,
          status: "in_progress",
        })
        .mockResolvedValueOnce(mockOptimization);

      const result = await service.runOptimization("test-portfolio-1", {
        method: OptimizationMethod.MEAN_VARIANCE,
      });

      expect(result.status).toBe("completed");
      expect(optimizationRepository.save).toHaveBeenCalled();
    });

    it("should throw if portfolio has no assets", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.find.mockResolvedValue([]);

      await expect(
        service.runOptimization("test-portfolio-1", {
          method: OptimizationMethod.MEAN_VARIANCE,
        }),
      ).rejects.toThrow("Portfolio has no assets to optimize");
    });
  });

  describe("approveOptimization", () => {
    it("should approve completed optimization", async () => {
      optimizationRepository.findOne.mockResolvedValue(mockOptimization);

      const result = await service.approveOptimization("opt-1", "Looks good");

      expect(result.status).toBe("approved");
      expect(optimizationRepository.save).toHaveBeenCalled();
    });

    it("should throw if optimization not found", async () => {
      optimizationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.approveOptimization("non-existent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw if optimization is not completed", async () => {
      const pendingOptimization = {
        ...mockOptimization,
        status: "in_progress",
      };
      optimizationRepository.findOne.mockResolvedValue(pendingOptimization);

      await expect(
        service.approveOptimization("opt-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("implementOptimization", () => {
    it("should implement approved optimization", async () => {
      const approvedOptimization = {
        ...mockOptimization,
        status: "approved",
      };
      optimizationRepository.findOne.mockResolvedValue(approvedOptimization);
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const result = await service.implementOptimization("opt-1");

      expect(result.targetAllocation).toEqual(
        approvedOptimization.suggestedAllocation,
      );
      expect(optimizationRepository.save).toHaveBeenCalled();
    });

    it("should throw if optimization not found", async () => {
      optimizationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.implementOptimization("non-existent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw if optimization is not approved", async () => {
      optimizationRepository.findOne.mockResolvedValue(mockOptimization);

      await expect(
        service.implementOptimization("opt-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("addHolding", () => {
    it("should add a new holding to portfolio", async () => {
      const dto: AddHoldingDto = {
        ticker: "ETH",
        name: "Ethereum",
        chain: Chain.ETHEREUM,
        quantity: 10,
        currentPrice: 2000,
        costBasis: 15000,
      };

      assetRepository.findOne.mockResolvedValue(null);
      assetRepository.create.mockReturnValue({ ...mockAsset, ...dto });
      assetRepository.save.mockResolvedValue({ ...mockAsset, ...dto });

      const result = await service.addHolding("test-portfolio-1", dto);

      expect(assetRepository.findOne).toHaveBeenCalledWith({
        where: {
          portfolioId: "test-portfolio-1",
          ticker: dto.ticker,
          chain: dto.chain,
        },
      });
      expect(assetRepository.create).toHaveBeenCalled();
      expect(assetRepository.save).toHaveBeenCalled();
      expect(result.ticker).toBe(dto.ticker);
      expect(result.chain).toBe(dto.chain);
    });

    it("should throw error if holding already exists", async () => {
      const dto: AddHoldingDto = {
        ticker: "ETH",
        name: "Ethereum",
        chain: Chain.ETHEREUM,
        quantity: 10,
        currentPrice: 2000,
        costBasis: 15000,
      };

      assetRepository.findOne.mockResolvedValue(mockAsset);

      await expect(service.addHolding("test-portfolio-1", dto)).rejects.toThrow(
        "Holding with same ticker and chain already exists",
      );
    });
  });

  describe("updateHolding", () => {
    it("should update holding in portfolio", async () => {
      const dto: UpdateHoldingDto = {
        quantity: 20,
        currentPrice: 2500,
      };

      const updatedAsset = { ...mockAsset, ...dto, value: 50000 };
      assetRepository.findOne.mockResolvedValue(mockAsset);
      assetRepository.save.mockResolvedValue(updatedAsset);

      const result = await service.updateHolding(
        "test-portfolio-1",
        "asset-1",
        dto,
      );

      expect(assetRepository.findOne).toHaveBeenCalledWith({
        where: { id: "asset-1", portfolioId: "test-portfolio-1" },
      });
      expect(assetRepository.save).toHaveBeenCalled();
    });

    it("should throw error if holding not found", async () => {
      const dto: UpdateHoldingDto = { quantity: 20 };
      assetRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateHolding("test-portfolio-1", "non-existent", dto),
      ).rejects.toThrow("Holding not found");
    });
  });

  describe("removeHolding", () => {
    it("should remove holding from portfolio", async () => {
      assetRepository.findOne.mockResolvedValue(mockAsset);
      assetRepository.remove.mockResolvedValue(null);

      await service.removeHolding("test-portfolio-1", "asset-1");

      expect(assetRepository.findOne).toHaveBeenCalledWith({
        where: { id: "asset-1", portfolioId: "test-portfolio-1" },
      });
      expect(assetRepository.remove).toHaveBeenCalledWith(mockAsset);
    });

    it("should throw error if holding not found", async () => {
      assetRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeHolding("test-portfolio-1", "non-existent"),
      ).rejects.toThrow("Holding not found");
    });
  });
});
