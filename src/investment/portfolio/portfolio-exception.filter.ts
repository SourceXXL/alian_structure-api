import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
    Logger,
  } from '@nestjs/common';
  import { Request, Response } from 'express';
import { PortfolioException } from './Portfolio.exception';
  
  /**
   * Catches any `PortfolioException` (and subclasses) and serialises it into a
   * consistent structured JSON envelope.
   *
   * Register globally in `main.ts`:
   * ```ts
   * app.useGlobalFilters(new PortfolioExceptionFilter());
   * ```
   * Or per-controller via `@UseFilters(PortfolioExceptionFilter)`.
   */
  @Catch(PortfolioException)
  export class PortfolioExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(PortfolioExceptionFilter.name);
  
    catch(exception: PortfolioException, host: ArgumentsHost): void {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
  
      const status = exception.getStatus() ?? HttpStatus.INTERNAL_SERVER_ERROR;
      const body = exception.getResponse() as Record<string, unknown>;
  
      this.logger.warn(
        `[PortfolioException] ${body['errorCode']} — ${body['message']} | ` +
          `${request.method} ${request.url}`,
      );
  
      response.status(status).json({
        ...body,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }
  }