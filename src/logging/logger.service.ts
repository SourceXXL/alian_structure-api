/**
 * LoggerService — centralized Winston-backed logging service.
 *
 * Implements NestJS's {@link LoggerService} interface so it can replace the
 * default Nest logger while also exposing a richer API for structured logging.
 *
 * Usage:
 * ```ts
 * // Basic injection
 * constructor(private readonly log: LoggerService) {}
 *
 * // Scoped child logger
 * private readonly log = this.loggerService.forContext('MyComponent');
 * ```
 */

import {
  Injectable,
  LoggerService as NestLoggerService,
  Optional,
} from "@nestjs/common";
import * as winston from "winston";
import {
  createWinstonLogger,
  LogLevel,
  LoggerModuleOptions,
} from "./winston.config";
import { sanitizeObject, formatError, sanitizeValue } from "./sanitize.util";

// ---------------------------------------------------------------------------
// Injection token
// ---------------------------------------------------------------------------
export const LOGGER_OPTIONS = Symbol("LOGGER_OPTIONS");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuredLogEntry {
  /** Human-readable message */
  message: string;
  /** Correlation / request ID for tracing a request end-to-end */
  requestId?: string;
  /** Component / class originating the log line */
  context?: string;
  /** Arbitrary structured metadata */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly winston: winston.Logger;
  private readonly _context: string | undefined;

  constructor(@Optional() private readonly opts: LoggerModuleOptions = {}) {
    this.winston = createWinstonLogger(opts);
  }

  // -------------------------------------------------------------------------
  // NestJS LoggerService interface
  // -------------------------------------------------------------------------

  log(message: unknown, context?: string): void {
    this.info(this.toEntry(message, context));
  }

  error(message: unknown, trace?: string, context?: string): void {
    const entry = this.toEntry(message, context);
    if (trace) entry.stack = trace;
    this._log("error", entry);
  }

  warn(message: unknown, context?: string): void {
    this._log("warn", this.toEntry(message, context));
  }

  debug(message: unknown, context?: string): void {
    this._log("debug", this.toEntry(message, context));
  }

  verbose(message: unknown, context?: string): void {
    this._log("verbose", this.toEntry(message, context));
  }

  // -------------------------------------------------------------------------
  // Extended structured API
  // -------------------------------------------------------------------------

  info(
    entry: StructuredLogEntry | string,
    meta?: Record<string, unknown>,
  ): void {
    this._log("info", this.normalise(entry, meta));
  }

  fatal(
    entry: StructuredLogEntry | string,
    meta?: Record<string, unknown>,
  ): void {
    this._log("fatal", this.normalise(entry, meta));
  }

  /**
   * Creates a child logger pre-scoped to a named context.
   *
   * @param context - Component / module name shown in every log line
   */
  forContext(context: string): ScopedLoggerService {
    return new ScopedLoggerService(this, context);
  }

  /**
   * Logs an error with full stack trace capture.
   * Sensitive information in the message is automatically redacted.
   */
  logError(
    error: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const entry: StructuredLogEntry = {
      message: error instanceof Error ? error.message : String(error),
      context: context ?? this._context,
      error: formatError(error),
      ...this.sanitiseMeta(extra),
    };
    this._log("error", entry);
  }

  /**
   * Logs a performance metric (always at INFO level).
   * Intended for slow-operation alerting — callers should check the threshold
   * themselves before calling.
   */
  logPerformance(metric: {
    operation: string;
    durationMs: number;
    context?: string;
    requestId?: string;
    [key: string]: unknown;
  }): void {
    this._log("info", {
      message: `Performance metric: ${metric.operation}`,
      type: "performance",
      ...metric,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Central dispatch — all log calls funnel through here so that the
   * sanitisation step is never accidentally bypassed.
   */
  private _log(level: LogLevel, entry: Record<string, unknown>): void {
    const { message, ...meta } = entry;
    this.winston[level](
      String(message),
      sanitizeObject(meta as Record<string, unknown>),
    );
  }

  /** Converts a Nest-style `(message, context)` pair into a {@link StructuredLogEntry}. */
  private toEntry(message: unknown, context?: string): StructuredLogEntry {
    if (typeof message === "object" && message !== null) {
      return {
        message: (message as any).message ?? JSON.stringify(message),
        context: context ?? (message as any).context,
        ...((message as any) ?? {}),
      };
    }
    return { message: String(message), context: context ?? this._context };
  }

  /** Normalises the overloaded string-or-object first argument. */
  private normalise(
    entry: StructuredLogEntry | string,
    meta?: Record<string, unknown>,
  ): StructuredLogEntry {
    const base: StructuredLogEntry =
      typeof entry === "string" ? { message: entry } : { ...entry };

    if (this._context && !base.context) base.context = this._context;
    if (meta) Object.assign(base, this.sanitiseMeta(meta));
    return base;
  }

  /** Deep-sanitises arbitrary metadata before merging into a log entry. */
  private sanitiseMeta(
    meta?: Record<string, unknown>,
  ): Record<string, unknown> {
    return meta ? (sanitizeValue(meta) as Record<string, unknown>) : {};
  }

  /**
   * Exposes the underlying Winston instance for transports that need to attach
   * to it directly (e.g., CloudWatch, ELK transports).
   */
  get winstonLogger(): winston.Logger {
    return this.winston;
  }
}

// ---------------------------------------------------------------------------
// ScopedLoggerService — thin wrapper that pre-fills `context`
// ---------------------------------------------------------------------------

/**
 * A logger pre-scoped to a specific context/component.
 * Returned by {@link LoggerService.forContext}.
 */
export class ScopedLoggerService implements NestLoggerService {
  constructor(
    private readonly parent: LoggerService,
    private readonly context: string,
  ) {}

  log(message: unknown): void {
    this.parent.log(message, this.context);
  }

  error(message: unknown, trace?: string): void {
    this.parent.error(message, trace, this.context);
  }

  warn(message: unknown): void {
    this.parent.warn(message, this.context);
  }

  debug(message: unknown): void {
    this.parent.debug(message, this.context);
  }

  verbose(message: unknown): void {
    this.parent.verbose(message, this.context);
  }

  info(
    entry: StructuredLogEntry | string,
    meta?: Record<string, unknown>,
  ): void {
    const e = typeof entry === "string" ? { message: entry } : entry;
    this.parent.info({ ...e, context: this.context }, meta);
  }

  fatal(
    entry: StructuredLogEntry | string,
    meta?: Record<string, unknown>,
  ): void {
    const e = typeof entry === "string" ? { message: entry } : entry;
    this.parent.fatal({ ...e, context: this.context }, meta);
  }

  logError(error: unknown, extra?: Record<string, unknown>): void {
    this.parent.logError(error, this.context, extra);
  }

  logPerformance(metric: {
    operation: string;
    durationMs: number;
    requestId?: string;
    [key: string]: unknown;
  }): void {
    this.parent.logPerformance({ ...metric, context: this.context });
  }
}
