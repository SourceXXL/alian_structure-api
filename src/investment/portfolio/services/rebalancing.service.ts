import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import {
  RebalancingEvent,
  RebalanceTrigger,
  RebalanceStatus,
} from "../entities/rebalancing-event.entity";
import { Portfolio } from "../entities/portfolio.entity";
import { PortfolioAsset } from "../entities/portfolio-asset.entity";
import { PortfolioService } from "./portfolio.service";
import { TradingTransactionService } from "./trading-transaction.service";
import { AuditLogService } from "src/infrastructure/audit/audit-log.service";
import { AlertDispatcherService } from "src/growth/alerts/services/alert-dispatcher.service";
import { TransactionOptimizationService } from "src/defi/services/transaction-optimization.service";

@Injectable()
export class RebalancingService {
  private readonly logger = new Logger(RebalancingService.name);
  private readonly DEFAULT_THRESHOLD = 5;
  private readonly SLIPPAGE_LIMIT = 0.02;

  constructor(
    @InjectRepository(RebalancingEvent)
    private rebalancingRepository: Repository<RebalancingEvent>,
    @InjectRepository(Portfolio)
    private portfolioRepository: Repository<Portfolio>,
    @InjectRepository(PortfolioAsset)
    private portfolioAssetRepository: Repository<PortfolioAsset>,
    private portfolioService: PortfolioService,
    private tradingService: TradingTransactionService,
    private auditLogService: AuditLogService,
    private alertService: AlertDispatcherService,
    private transactionOptimizationService: TransactionOptimizationService,
    @InjectQueue("rebalancing") private rebalancingQueue: Queue,
  ) {}

  /**
   * Determine whether deviation exceeds threshold.
   */
  async shouldRebalance(
    portfolioId: string,
    customThreshold?: number,
  ): Promise<{ shouldRebalance: boolean; maxDrift: number }> {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);
    if (!portfolio.targetAllocation) {
      return { shouldRebalance: false, maxDrift: 0 };
    }

    const threshold =
      customThreshold ?? portfolio.rebalanceThreshold ?? this.DEFAULT_THRESHOLD;
    let maxDrift = 0;

    for (const [ticker, targetPercentage] of Object.entries(
      portfolio.targetAllocation,
    )) {
      const asset = await this.portfolioAssetRepository.findOne({
        where: { portfolioId, ticker },
      });

      if (asset) {
        const drift = Math.abs(
          asset.allocationPercentage - (targetPercentage as number),
        );
        if (drift > maxDrift) maxDrift = drift;
      }
    }

    return {
      shouldRebalance: maxDrift > threshold,
      maxDrift,
    };
  }

  /**
   * Simulate rebalancing without executing trades.
   */
  async simulateRebalance(portfolioId: string): Promise<{
    expectedAllocations: Record<string, number>;
    tradePlan: any[];
    gasEstimate: number;
    expectedSlippage: number;
    warnings: string[];
  }> {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);
    const trades = await this.calculateRebalancingTrades(portfolioId);

    // Mock gas and slippage estimation based on trade count and volume
    const gasEstimate = trades.length * 0.005; // Dummy ETH gas estimate
    const expectedSlippage = trades.length > 5 ? 0.015 : 0.005; // Higher slippage for more trades
    const warnings = [];

    if (expectedSlippage > this.SLIPPAGE_LIMIT) {
      warnings.push("High expected slippage detected");
    }

    await this.auditLogService.recordVerification({
      type: "REBALANCE_SIMULATION",
      portfolioId,
      tradeCount: trades.length,
      gasEstimate,
      expectedSlippage,
    });

    return {
      expectedAllocations: portfolio.targetAllocation || {},
      tradePlan: trades,
      gasEstimate,
      expectedSlippage,
      warnings,
    };
  }

  /**
   * Cancel execution if slippage > 2%
   */
  validateSlippage(slippage: number): { safe: boolean; error?: string } {
    if (slippage > this.SLIPPAGE_LIMIT) {
      return {
        safe: false,
        error: `Slippage ${slippage * 100}% exceeds limit of ${
          this.SLIPPAGE_LIMIT * 100
        }%`,
      };
    }
    return { safe: true };
  }

  /**
   * Execute rebalancing with batching and optimizations.
   */
  async executeRebalancing(
    rebalancingEventId: string,
    actualCost?: number,
    slippage: number = 0,
    dryRun: boolean = false,
  ): Promise<RebalancingEvent> {
    const event = await this.rebalancingRepository.findOne({
      where: { id: rebalancingEventId },
      relations: ["portfolio"],
    });

    if (!event) {
      throw new BadRequestException("Rebalancing event not found");
    }

    // Notify user before execution
    await this.alertService.dispatch(event.portfolio.userId, {
      type: "REBALANCE_STARTED",
      portfolioId: event.portfolioId,
      message: `Rebalancing execution started for portfolio ${event.portfolio.name}`,
    });

    const slippageCheck = this.validateSlippage(slippage);
    if (!slippageCheck.safe) {
      event.status = RebalanceStatus.FAILED;
      event.failureReason = slippageCheck.error;
      await this.rebalancingRepository.save(event);

      await this.alertService.dispatch(event.portfolio.userId, {
        type: "REBALANCE_CANCELLED",
        portfolioId: event.portfolioId,
        reason: slippageCheck.error,
      });

      await this.auditLogService.recordVerification({
        type: "REBALANCE_SLIPPAGE_FAILURE",
        portfolioId: event.portfolioId,
        slippage,
      });

      throw new BadRequestException(slippageCheck.error);
    }

    if (dryRun) {
      this.logger.log(`Dry run for rebalancing event ${rebalancingEventId}`);
      return event;
    }

    event.status = RebalanceStatus.IN_PROGRESS;
    await this.rebalancingRepository.save(event);

    try {
      // Execute trades in batches to minimize gas/impact
      const batchSize = 3;
      for (let i = 0; i < event.trades.length; i += batchSize) {
        const batch = event.trades.slice(i, i + batchSize);
        await Promise.all(
          batch.map((trade) =>
            this.tradingService.executeTrade(
              event.portfolioId,
              trade.ticker,
              trade.action,
              trade.quantity,
              trade.price,
            ),
          ),
        );
      }

      // Update portfolio
      const portfolio = event.portfolio;
      portfolio.currentAllocation = event.allocationAfter;
      portfolio.lastRebalanceDate = new Date();
      await this.portfolioRepository.save(portfolio);

      // Finalize event
      event.status = RebalanceStatus.COMPLETED;
      event.actualCost = actualCost || event.estimatedCost;
      event.executionSlippage = slippage;
      event.executedAt = new Date();
      event.completedAt = new Date();
      await this.rebalancingRepository.save(event);

      // Audit & Notify
      await this.auditLogService.recordVerification({
        type: "REBALANCE_SUCCESS",
        portfolioId: event.portfolioId,
        eventId: event.id,
      });

      await this.alertService.dispatch(portfolio.userId, {
        type: "REBALANCE_SUCCESS",
        portfolioId: portfolio.id,
        message: `Successfully rebalanced portfolio ${portfolio.name}`,
      });

      return event;
    } catch (error) {
      event.status = RebalanceStatus.FAILED;
      event.failureReason = error.message;
      await this.rebalancingRepository.save(event);

      await this.alertService.dispatch(event.portfolio.userId, {
        type: "REBALANCE_FAILED",
        portfolioId: event.portfolioId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Schedule rebalancing using Bull queue.
   */
  async scheduleRebalance(
    portfolioId: string,
    frequency: "daily" | "weekly" | "monthly" | "custom",
    cron?: string,
  ): Promise<void> {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);

    // Prevent duplicate scheduling by checking existing repeatable jobs
    const jobs = await this.rebalancingQueue.getRepeatableJobs();
    const existingJob = jobs.find((j) => j.id === `rebalance-${portfolioId}`);
    if (existingJob) {
      await this.rebalancingQueue.removeRepeatableByKey(existingJob.key);
    }

    let cronExpression = cron;
    if (!cronExpression) {
      switch (frequency) {
        case "daily":
          cronExpression = "0 0 * * *";
          break;
        case "weekly":
          cronExpression = "0 0 * * 0";
          break;
        case "monthly":
          cronExpression = "0 0 1 * *";
          break;
        default:
          cronExpression = "0 0 * * *";
      }
    }

    await this.rebalancingQueue.add(
      "rebalance-task",
      { portfolioId },
      {
        repeat: { cron: cronExpression },
        jobId: `rebalance-${portfolioId}`,
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Scheduled ${frequency} rebalancing for portfolio ${portfolioId}`,
    );
  }

  /**
   * Check if portfolio needs rebalancing (Old method, kept for compatibility if needed, but updated to use shouldRebalance)
   */
  async checkRebalancingNeeded(portfolioId: string): Promise<boolean> {
    const result = await this.shouldRebalance(portfolioId);
    return result.shouldRebalance;
  }

  /**
   * Calculate rebalancing trades
   */
  async calculateRebalancingTrades(portfolioId: string): Promise<
    Array<{
      ticker: string;
      action: "buy" | "sell";
      quantity: number;
      price: number;
      value: number;
      estimatedTaxImpact: number;
    }>
  > {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);
    const assets = await this.portfolioAssetRepository.find({
      where: { portfolioId },
    });

    const trades: any[] = [];

    for (const asset of assets) {
      const targetPercentage = portfolio.targetAllocation?.[asset.ticker] || 0;
      const currentPercentage = asset.allocationPercentage || 0;
      const difference = targetPercentage - currentPercentage;

      if (Math.abs(difference) > 0.5) {
        const targetValue = (targetPercentage / 100) * portfolio.totalValue;
        const currentValue = (currentPercentage / 100) * portfolio.totalValue;
        const valueDifference = targetValue - currentValue;

        const quantity = valueDifference / (asset.currentPrice || 1);
        const action = quantity > 0 ? "buy" : "sell";
        let estimatedTaxImpact = 0;

        if (action === "sell") {
          const capitalGains = Math.max(
            0,
            (asset.currentPrice - (asset.costBasisPerShare || 0)) *
              Math.abs(quantity),
          );
          estimatedTaxImpact = capitalGains * 0.15;
        }

        trades.push({
          ticker: asset.ticker,
          action,
          quantity: Math.abs(quantity),
          price: asset.currentPrice || 0,
          value: Math.abs(valueDifference),
          estimatedTaxImpact,
        });
      }
    }

    return trades;
  }

  /**
   * Trigger rebalancing
   */
  async triggerRebalancing(
    portfolioId: string,
    trigger: RebalanceTrigger,
    reason?: string,
  ): Promise<RebalancingEvent> {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);
    const allocationBefore = { ...portfolio.currentAllocation };
    const trades = await this.calculateRebalancingTrades(portfolioId);

    const event = this.rebalancingRepository.create({
      portfolioId,
      trigger,
      status: RebalanceStatus.PENDING,
      triggerReason: reason,
      allocationBefore,
      allocationAfter:
        portfolio.targetAllocation || portfolio.currentAllocation,
      trades,
      estimatedCost: trades.reduce((sum, t) => sum + t.value, 0),
      taxImpact: trades.reduce(
        (sum, t) => sum + (t.estimatedTaxImpact || 0),
        0,
      ),
    });

    return this.rebalancingRepository.save(event);
  }

  /**
   * Approve rebalancing
   */
  async approveRebalancing(
    rebalancingEventId: string,
  ): Promise<RebalancingEvent> {
    const event = await this.rebalancingRepository.findOne({
      where: { id: rebalancingEventId },
    });

    if (!event) {
      throw new BadRequestException("Rebalancing event not found");
    }

    event.status = RebalanceStatus.IN_PROGRESS;
    return this.rebalancingRepository.save(event);
  }

  /**
   * Cancel rebalancing
   */
  async cancelRebalancing(
    rebalancingEventId: string,
    reason: string,
  ): Promise<RebalancingEvent> {
    const event = await this.rebalancingRepository.findOne({
      where: { id: rebalancingEventId },
    });

    if (!event) {
      throw new BadRequestException("Rebalancing event not found");
    }

    event.status = RebalanceStatus.CANCELLED;
    event.failureReason = reason;

    return this.rebalancingRepository.save(event);
  }

  /**
   * Get rebalancing history
   */
  async getRebalancingHistory(
    portfolioId: string,
    limit: number = 10,
  ): Promise<RebalancingEvent[]> {
    return this.rebalancingRepository.find({
      where: { portfolioId },
      order: { createdAt: "DESC" },
      take: limit,
    });
  }

  /**
   * Calculate allocation drift
   */
  async calculateAllocationDrift(
    portfolioId: string,
  ): Promise<Record<string, number>> {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);
    const assets = await this.portfolioAssetRepository.find({
      where: { portfolioId },
    });

    const drift: Record<string, number> = {};

    for (const asset of assets) {
      const targetPercentage = portfolio.targetAllocation?.[asset.ticker] || 0;
      drift[asset.ticker] =
        asset.allocationPercentage - (targetPercentage as number);
    }

    return drift;
  }

  /**
   * Check automatic rebalancing triggers
   */
  async checkAutoRebalancingTriggers(portfolioId: string): Promise<boolean> {
    const portfolio = await this.portfolioService.getPortfolio(portfolioId);

    if (!portfolio.autoRebalanceEnabled) {
      return false;
    }

    if (portfolio.rebalanceFrequency) {
      const lastRebalance = portfolio.lastRebalanceDate || portfolio.createdAt;
      const now = new Date();
      const daysSinceRebalance =
        (now.getTime() - lastRebalance.getTime()) / (1000 * 60 * 60 * 24);

      const frequencyDays = this.frequencyToDays(portfolio.rebalanceFrequency);

      if (daysSinceRebalance >= frequencyDays) {
        this.logger.log(`Time-based rebalancing triggered for ${portfolioId}`);
        return true;
      }
    }

    const { shouldRebalance } = await this.shouldRebalance(portfolioId);
    if (shouldRebalance) {
      this.logger.log(`Drift-based rebalancing triggered for ${portfolioId}`);
    }

    return shouldRebalance;
  }

  private frequencyToDays(
    frequency: "daily" | "weekly" | "monthly" | "quarterly",
  ): number {
    switch (frequency) {
      case "daily":
        return 1;
      case "weekly":
        return 7;
      case "monthly":
        return 30;
      case "quarterly":
        return 90;
      default:
        return 90;
    }
  }
}
