/**
 * HttpLoggingMiddleware
 *
 * Winston-backed replacement for the existing pino-based LoggingMiddleware.
 * Logs every inbound request and its corresponding response with:
 *   - HTTP method, path, status code, and response time
 *   - Sanitized headers and request body
 *   - Request correlation ID (`x-request-id` header)
 *   - Automatic level escalation for 4xx (WARN) and 5xx (ERROR) responses
 *
 * The middleware is intentionally kept separate from the existing
 * {@link LoggingMiddleware} so both can coexist during migration.
 */

import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { LoggerService } from "./logger.service";
import {
  sanitizeHeaders,
  sanitizeObject,
  sanitizeQuery,
} from "./sanitize.util";
import { LogLevel } from "./winston.config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HttpLoggingConfig {
  /** Set to false to disable all HTTP logging from this middleware. */
  enabled?: boolean;
  /** Request headers whose values are masked. Merged with the default set. */
  extraSensitiveHeaders?: Set<string>;
  /** Body field names (case-insensitive) to mask. Merged with the default set. */
  extraSensitiveBodyFields?: Set<string>;
  /** Bodies larger than this many bytes (from Content-Length) are skipped. Default 10 KB. */
  maxBodySizeBytes?: number;
  /**
   * Per-route log-level overrides.  Evaluated in order; first match wins.
   * A level of `"silent"` suppresses the log entry entirely.
   */
  routeOverrides?: Array<{
    pattern: RegExp | string;
    level: LogLevel | "silent";
  }>;
}

const DEFAULT_CONFIG: Required<HttpLoggingConfig> = {
  enabled: true,
  extraSensitiveHeaders: new Set(),
  extraSensitiveBodyFields: new Set(),
  maxBodySizeBytes: 10 * 1024,
  routeOverrides: [
    { pattern: /^\/health/, level: "debug" },
    { pattern: /^\/metrics/, level: "silent" },
    { pattern: /^\/api\/v1\/health/, level: "debug" },
  ],
};

export const REQUEST_ID_HEADER = "x-request-id";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  private readonly cfg: Required<HttpLoggingConfig>;

  constructor(
    private readonly logger: LoggerService,
    config?: Partial<HttpLoggingConfig>,
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.cfg.enabled) return next();

    // Assign / propagate request ID
    const requestId =
      (req.headers[REQUEST_ID_HEADER] as string | undefined) || uuidv4();
    (req as any).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startNs = process.hrtime.bigint();
    const routeLevel = this.resolveLevel(req.path);

    // Log incoming request
    if (routeLevel !== "silent") {
      this.logger[routeLevel as LogLevel]({
        message: `→ ${req.method} ${req.path}`,
        context: "HttpLogging",
        requestId,
        http: {
          method: req.method,
          path: req.path,
          query: sanitizeQuery(req.query as Record<string, unknown>),
          headers: sanitizeHeaders(
            req.headers as Record<string, unknown>,
            this.cfg.extraSensitiveHeaders,
          ),
          body: this.maybeBody(req),
          ip: this.clientIp(req),
          userAgent: req.headers["user-agent"],
        },
      });
    }

    res.on("finish", () => {
      const latencyMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const responseLevel = this.responseLevel(res.statusCode, routeLevel);

      if (responseLevel === "silent") return;

      this.logger[responseLevel as LogLevel]({
        message: `← ${req.method} ${req.path} ${res.statusCode} (${latencyMs.toFixed(2)}ms)`,
        context: "HttpLogging",
        requestId,
        http: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          latencyMs: parseFloat(latencyMs.toFixed(3)),
          responseSize: parseInt(
            (res.getHeader("content-length") as string | undefined) ?? "0",
            10,
          ),
        },
      });

      // Log slow requests as warnings
      if (latencyMs > 1000) {
        this.logger.warn({
          message: `Slow request detected: ${req.method} ${req.path} took ${latencyMs.toFixed(2)}ms`,
          context: "HttpLogging",
          requestId,
          slowRequest: {
            method: req.method,
            path: req.path,
            latencyMs: parseFloat(latencyMs.toFixed(3)),
            statusCode: res.statusCode,
          },
        });
      }
    });

    next();
  }

  // ---------------------------------------------------------------------------
  // Helpers — exposed for unit testing
  // ---------------------------------------------------------------------------

  resolveLevel(path: string): LogLevel | "silent" {
    for (const { pattern, level } of this.cfg.routeOverrides) {
      const matched =
        pattern instanceof RegExp
          ? pattern.test(path)
          : path.startsWith(pattern as string);
      if (matched) return level;
    }
    return "info";
  }

  responseLevel(
    statusCode: number,
    routeLevel: LogLevel | "silent",
  ): LogLevel | "silent" {
    if (routeLevel === "silent") return "silent";
    if (statusCode >= 500) return "error";
    if (statusCode >= 400) return "warn";
    return routeLevel as LogLevel;
  }

  maybeBody(req: Request): unknown {
    const contentLength = parseInt(
      (req.headers["content-length"] as string | undefined) ?? "0",
      10,
    );
    if (contentLength > this.cfg.maxBodySizeBytes) {
      return `[BODY_TOO_LARGE: ${contentLength} bytes]`;
    }
    if (!req.body || Object.keys(req.body).length === 0) return undefined;

    return sanitizeObject(req.body, 0, this.cfg.extraSensitiveBodyFields);
  }

  clientIp(req: Request): string {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0].trim();
    }
    return req.ip ?? "unknown";
  }
}
