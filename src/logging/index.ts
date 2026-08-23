/**
 * Public API for the `src/logging` module.
 *
 * Other modules should import from this barrel rather than from individual
 * files so internal file moves never break consumers.
 *
 * ```ts
 * import { LoggerModule, LoggerService, PerformanceInterceptor } from 'src/logging';
 * ```
 */

export { LoggerModule } from "./logger.module";
export type {
  LoggerRootOptions,
  LoggerModuleAsyncOptions,
} from "./logger.module";

export {
  LoggerService,
  ScopedLoggerService,
  LOGGER_OPTIONS,
} from "./logger.service";
export type { StructuredLogEntry } from "./logger.service";

export { HttpLoggingMiddleware } from "./http-logging.middleware";
export type { HttpLoggingConfig } from "./http-logging.middleware";

export { PerformanceInterceptor } from "./performance.interceptor";
export type { PerformanceInterceptorConfig } from "./performance.interceptor";

export { ElkTransport, createElkTransport } from "./elk.transport";
export type { ElkTransportOptions } from "./elk.transport";

export { createCloudWatchTransport } from "./cloudwatch.transport";
export type { CloudWatchTransportOptions } from "./cloudwatch.transport";

export {
  SENSITIVE_FIELDS,
  SENSITIVE_HEADERS,
  REDACTED,
  sanitizeValue,
  sanitizeObject,
  sanitizeHeaders,
  sanitizeQuery,
  sanitizeErrorMessage,
  formatError,
} from "./sanitize.util";

export {
  createWinstonLogger,
  createJsonFormat,
  createPrettyFormat,
  createConsoleTransport,
  createFileTransports,
  LOG_LEVELS,
  LOG_LEVEL_COLORS,
} from "./winston.config";
export type { LogLevel, LoggerModuleOptions } from "./winston.config";
