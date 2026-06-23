import { HttpStatus } from '@nestjs/common';
import { PortfolioException } from './Portfolio.exception';

export type OptimizationFailureReason =
  | 'CONVERGENCE_FAILURE'      // Solver did not converge within iteration limit
  | 'INFEASIBLE_CONSTRAINTS'   // Constraints are mutually exclusive
  | 'INSUFFICIENT_ASSETS'      // Not enough eligible assets to optimise
  | 'MODEL_UNAVAILABLE'        // ML model endpoint unreachable / timed out
  | 'INVALID_RISK_PARAMETERS'  // Risk tolerance input outside supported range
  | 'UNKNOWN';

/**
 * Thrown when the portfolio optimisation engine (mean-variance, ML-based, etc.)
 * cannot produce a valid allocation for the given inputs.
 *
 * @example
 * throw new OptimizationFailedException(
 *   'CONVERGENCE_FAILURE',
 *   { iterations: 1000, tolerance: 1e-6 },
 * );
 */
export class OptimizationFailedException extends PortfolioException {
  readonly reason: OptimizationFailureReason;
  readonly context?: Record<string, unknown>;

  constructor(
    reason: OptimizationFailureReason = 'UNKNOWN',
    context?: Record<string, unknown>,
  ) {
    const reasonMessages: Record<OptimizationFailureReason, string> = {
      CONVERGENCE_FAILURE:
        'Portfolio optimisation did not converge. Try relaxing constraints or increasing the iteration limit.',
      INFEASIBLE_CONSTRAINTS:
        'The provided constraints cannot be satisfied simultaneously. Review allocation bounds.',
      INSUFFICIENT_ASSETS:
        'Not enough eligible assets are available to run optimisation. A minimum of 2 assets is required.',
      MODEL_UNAVAILABLE:
        'The ML optimisation model is currently unavailable. Please retry shortly.',
      INVALID_RISK_PARAMETERS:
        'Risk tolerance parameters are outside the supported range [0, 1].',
      UNKNOWN: 'Portfolio optimisation failed for an unknown reason.',
    };

    super(
      reasonMessages[reason],
      'PORTFOLIO_OPTIMIZATION_FAILED',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    this.reason = reason;
    this.context = context;
  }
}