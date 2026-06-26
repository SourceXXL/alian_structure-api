import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { RebalancingService } from "../services/rebalancing.service";
import { RebalanceTrigger } from "../entities/rebalancing-event.entity";

@Processor("rebalancing")
export class RebalancingProcessor {
  private readonly logger = new Logger(RebalancingProcessor.name);

  constructor(private readonly rebalancingService: RebalancingService) {}

  @Process("rebalance-task")
  async handleRebalanceTask(job: Job<{ portfolioId: string }>) {
    const { portfolioId } = job.data;
    this.logger.log(
      `Processing scheduled rebalance for portfolio: ${portfolioId}`,
    );

    try {
      const { shouldRebalance } =
        await this.rebalancingService.shouldRebalance(portfolioId);

      if (shouldRebalance) {
        this.logger.log(
          `Portfolio ${portfolioId} needs rebalancing. Triggering...`,
        );
        const event = await this.rebalancingService.triggerRebalancing(
          portfolioId,
          RebalanceTrigger.TIME_BASED,
          "Scheduled rebalancing triggered by system",
        );

        // For automated rebalancing, we might want to execute immediately if the portfolio is set to auto-rebalance
        // In this implementation, we simulate and then execute if safe.
        const simulation =
          await this.rebalancingService.simulateRebalance(portfolioId);

        if (simulation.expectedSlippage <= 0.02) {
          await this.rebalancingService.executeRebalancing(
            event.id,
            undefined,
            simulation.expectedSlippage,
          );
          this.logger.log(
            `Successfully executed scheduled rebalance for portfolio ${portfolioId}`,
          );
        } else {
          this.logger.warn(
            `Slippage too high for portfolio ${portfolioId}, skipping execution.`,
          );
          await this.rebalancingService.cancelRebalancing(
            event.id,
            "High slippage detected during scheduled task",
          );
        }
      } else {
        this.logger.log(
          `Portfolio ${portfolioId} does not need rebalancing at this time.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process rebalance task for portfolio ${portfolioId}`,
        error.stack,
      );
      throw error;
    }
  }
}
