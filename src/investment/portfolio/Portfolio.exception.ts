import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for all portfolio-domain exceptions.
 * Every derived class must supply a machine-readable `errorCode` so API
 * consumers can handle specific failure modes without parsing error messages.
 */
export abstract class PortfolioException extends HttpException {
  readonly errorCode: string;

  constructor(message: string, errorCode: string, status: HttpStatus) {
    super(
      {
        statusCode: status,
        errorCode,
        message,
        domain: 'portfolio',
      },
      status,
    );
    this.errorCode = errorCode;
  }
}