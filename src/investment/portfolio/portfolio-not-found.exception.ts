import { HttpStatus } from '@nestjs/common';
import { PortfolioException } from './Portfolio.exception';

/**
 * Thrown when a portfolio lookup by ID yields no result.
 * Keeps 404 semantics domain-specific so filters can handle it precisely.
 */
export class PortfolioNotFoundException extends PortfolioException {
  constructor(portfolioId: string) {
    super(
      `Portfolio with id "${portfolioId}" was not found.`,
      'PORTFOLIO_NOT_FOUND',
      HttpStatus.NOT_FOUND,
    );
  }
}