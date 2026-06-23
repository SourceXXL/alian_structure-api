import { HttpStatus } from '@nestjs/common';
import { PortfolioException } from './Portfolio.exception';

export type RebalancingFailureReason =
  | 'MARKET_CLOSED'            // Cannot trade outside market hours
  | 'PRICE_STALENESS'          // Asset prices are too stale to rebalance safely
  | 'ALLOCATION_DRIFT_SAFE'    // Drift is within tolerance; rebalance not needed
  | 'PARTIAL_EXECUTION'        // Some legs of the rebalance failed to execute
  | 'LOCK_CONFLICT'            // Another rebalance is already in progress
  | 'UNKNOWN';

/**
 * Thrown when a portfolio rebalancing operation cannot be completed.
 * Distinct from `OptimizationFailedException` — this covers execution-time
 * failures rather than planning-time failures.
 *
 * @example
 * throw new RebalancingFailedException('MARKET_CLOSED', { openAt: '09:30 EST' });
 */
export class RebalancingFailedException extends PortfolioException {
  readonly reason: RebalancingFailureReason;
  readonly context?: Record<string, unknown>;

  constructor(
    reason: RebalancingFailureReason = 'UNKNOWN',
    context?: Record<string, unknown>,
  ) {
    const reasonMessages: Record<RebalancingFailureReason, string> = {
      MARKET_CLOSED:
        'Rebalancing cannot proceed while the market is closed.',
      PRICE_STALENESS:
        'Asset prices are too stale to execute a safe rebalance. Prices will be refreshed automatically.',
      ALLOCATION_DRIFT_SAFE:
        'Portfolio allocation drift is within tolerance thresholds. No rebalancing is required.',
      PARTIAL_EXECUTION:
        'Rebalancing partially executed. Some trade legs failed. Manual review is required.',
      LOCK_CONFLICT:
        'A rebalancing operation is already in progress for this portfolio. Please wait.',
      UNKNOWN: 'Rebalancing failed for an unknown reason.',
    };

    super(
      reasonMessages[reason],
      'PORTFOLIO_REBALANCING_FAILED',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    this.reason = reason;
    this.context = context;
  }
}