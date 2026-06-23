import { HttpStatus } from '@nestjs/common';
import { PortfolioException } from './Portfolio.exception';

/**
 * Thrown when a financial operation (trade, rebalance, withdrawal) cannot
 * proceed because the portfolio lacks sufficient balance.
 *
 * @example
 * throw new InsufficientBalanceException({
 *   required: 5000,
 *   available: 3200,
 *   currency: 'USD',
 * });
 */
export class InsufficientBalanceException extends PortfolioException {
  readonly required: number;
  readonly available: number;
  readonly currency: string;

  constructor(params: { required: number; available: number; currency?: string }) {
    const { required, available, currency = 'USD' } = params;
    super(
      `Insufficient balance: operation requires ${currency} ${required.toFixed(2)} ` +
        `but only ${currency} ${available.toFixed(2)} is available.`,
      'PORTFOLIO_INSUFFICIENT_BALANCE',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    this.required = required;
    this.available = available;
    this.currency = currency;
  }
}