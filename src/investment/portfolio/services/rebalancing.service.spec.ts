import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { RebalancingService } from "./rebalancing.service";
import {
  RebalancingEvent,
  RebalanceStatus,
  RebalanceTrigger,
} from "../entities/rebalancing-event.entity";
import { Portfolio } from "../entities/portfolio.entity";
import { PortfolioAsset } from "../entities/portfolio-asset.entity";
import { PortfolioService } from "./portfolio.service";
import { TradingTransactionService } from "./trading-transaction.service";
import { AuditLogService } from "src/infrastructure/audit/audit-log.service";
import { AlertDispatcherService } from "src/growth/alerts/services/alert-dispatcher.service";
import { TransactionOptimizationService } from "src/defi/services/transaction-optimization.service";
import { getQueueToken } from "@nestjs/bull";
import { BadRequestException } from "@nestjs/common";

describe("RebalancingService", () => {
  let service: RebalancingService;
  let portfolioRepository: any;
  let portfolioAssetRepository: any;
  let rebalancingRepository: any;
  let portfolioService: any;
  let alertService: any;
  let auditLogService: any;

  const mockPortfolio = {
    id: "portfolio-1",
    userId: "user-1",
    name: "Test Portfolio",
    totalValue: 10000,
    targetAllocation: { BTC: 60, ETH: 40 },
    currentAllocation: { BTC: 50, ETH: 50 },
    rebalanceThreshold: 5,
  };

  const mockAssets = [
    { ticker: "BTC", allocationPercentage: 50, currentPrice: 50000 },
    { ticker: "ETH", allocationPercentage: 50, currentPrice: 2000 },
  ];

  beforeEach(async () => {
    portfolioRepository = {
      findOne: jest.fn().mockResolvedValue(mockPortfolio),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
    };
    portfolioAssetRepository = {
      find: jest.fn().mockResolvedValue(mockAssets),
      findOne: jest.fn().mockImplementation(({ where: { ticker } }) => {
        return Promise.resolve(mockAssets.find((a) => a.ticker === ticker));
      }),
    };
    rebalancingRepository = {
      create: jest.fn().mockImplementation((d) => ({ ...d, id: "event-1" })),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      findOne: jest.fn(),
    };
    portfolioService = {
      getPortfolio: jest.fn().mockResolvedValue(mockPortfolio),
    };
    alertService = {
      dispatch: jest.fn().mockResolvedValue(undefined),
    };
    auditLogService = {
      recordVerification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RebalancingService,
        {
          provide: getRepositoryToken(Portfolio),
          useValue: portfolioRepository,
        },
        {
          provide: getRepositoryToken(PortfolioAsset),
          useValue: portfolioAssetRepository,
        },
        {
          provide: getRepositoryToken(RebalancingEvent),
          useValue: rebalancingRepository,
        },
        { provide: PortfolioService, useValue: portfolioService },
        {
          provide: TradingTransactionService,
          useValue: { executeTrade: jest.fn() },
        },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: AlertDispatcherService, useValue: alertService },
        { provide: TransactionOptimizationService, useValue: {} },
        {
          provide: getQueueToken("rebalancing"),
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<RebalancingService>(RebalancingService);
  });

  it("should detect when rebalancing is needed", async () => {
    const result = await service.shouldRebalance("portfolio-1");
    expect(result.shouldRebalance).toBe(true);
    expect(result.maxDrift).toBe(10); // BTC drift is 10%
  });

  it("should not rebalance if drift is below threshold", async () => {
    const smallDriftPortfolio = {
      ...mockPortfolio,
      currentAllocation: { BTC: 58, ETH: 42 },
    };
    const smallDriftAssets = [
      { ticker: "BTC", allocationPercentage: 58 },
      { ticker: "ETH", allocationPercentage: 42 },
    ];
    portfolioService.getPortfolio.mockResolvedValue(smallDriftPortfolio);
    portfolioAssetRepository.findOne.mockImplementation(
      ({ where: { ticker } }) => {
        return Promise.resolve(
          smallDriftAssets.find((a) => a.ticker === ticker),
        );
      },
    );

    const result = await service.shouldRebalance("portfolio-1");
    expect(result.shouldRebalance).toBe(false);
    expect(result.maxDrift).toBe(2);
  });

  it("should simulate rebalancing with correct trades", async () => {
    const simulation = await service.simulateRebalance("portfolio-1");
    expect(simulation.tradePlan).toHaveLength(2);
    expect(simulation.gasEstimate).toBeGreaterThan(0);
    expect(auditLogService.recordVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "REBALANCE_SIMULATION",
      }),
    );
  });

  it("should validate slippage correctly", () => {
    expect(service.validateSlippage(0.01).safe).toBe(true);
    expect(service.validateSlippage(0.03).safe).toBe(false);
  });

  it("should fail execution if slippage exceeds limit", async () => {
    const mockEvent = {
      id: "event-1",
      portfolioId: "portfolio-1",
      portfolio: mockPortfolio,
      status: RebalanceStatus.PENDING,
    };
    rebalancingRepository.findOne.mockResolvedValue(mockEvent);

    await expect(
      service.executeRebalancing("event-1", undefined, 0.05),
    ).rejects.toThrow(BadRequestException);

    expect(alertService.dispatch).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "REBALANCE_CANCELLED",
      }),
    );
  });

  it("should execute rebalancing successfully", async () => {
    const mockEvent = {
      id: "event-1",
      portfolioId: "portfolio-1",
      portfolio: mockPortfolio,
      trades: [{ ticker: "BTC", action: "buy", quantity: 1, price: 50000 }],
      allocationAfter: { BTC: 60, ETH: 40 },
      status: RebalanceStatus.PENDING,
    };
    rebalancingRepository.findOne.mockResolvedValue(mockEvent);

    const result = await service.executeRebalancing("event-1", 100, 0.01);

    expect(result.status).toBe(RebalanceStatus.COMPLETED);
    expect(alertService.dispatch).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "REBALANCE_SUCCESS",
      }),
    );
    expect(auditLogService.recordVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "REBALANCE_SUCCESS",
      }),
    );
  });
});
