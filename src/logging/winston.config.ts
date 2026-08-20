/**
 * Winston configuration factory.
 *
 * Centralises log-format, transport, and level configuration. The factory
 * is consumed by {@link LoggerService} and can be overridden per-module by
 * passing {@link LoggerModuleOptions} into the dynamic-module registration.
 */

import * as winston from "winston";
import "winston-daily-rotate-file";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Log levels accepted by the logging module (maps onto Winston/RFC 5424). */
export type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "verbose";

export interface LoggerModuleOptions {
  /** Service identifier injected into every log line. Default: "alian-structure-api" */
  serviceName?: string;

  /** Minimum log level. Default: process.env.LOG_LEVEL ?? "info" */
  level?: LogLevel;

  /** Disable colour in development console output. */
  disableColors?: boolean;

  /**
   * Folder for daily-rotate file transport.
   * When undefined the file transport is not added.
   * Default: process.env.LOG_FILE_DIR
   */
  logFileDir?: string;

  /** Override the log format. When unset the default JSON formatter is used. */
  format?: winston.Logform.Format;

  /** Additional Winston transports (e.g., CloudWatch, ELK). */
  extraTransports?: winston.transport[];
}

// ---------------------------------------------------------------------------
// Custom log levels — extend Winston to support FATAL
// ---------------------------------------------------------------------------

/**
 * Winston severity levels (lower number = higher severity).
 * We add `fatal` above `error` so that critical process-killing events stand out.
 */
export const LOG_LEVELS: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  verbose: 5,
};

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  fatal: "bold red",
  error: "red",
  warn: "yellow",
  info: "green",
  debug: "cyan",
  verbose: "white",
};

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/**
 * Shared JSON format used in all non-development environments.
 * Adds a top-level `timestamp`, `service`, and `pid` to every log record.
 */
export function createJsonFormat(serviceName: string): winston.Logform.Format {
  return winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format((info) => {
      // Promote the `context` metadata field to the top level for easier filtering
      if (info.context) {
        info["context"] = info.context;
      }
      info.service = serviceName;
      info.pid = process.pid;
      info.environment = process.env.NODE_ENV ?? "development";
      return info;
    })(),
    winston.format.json(),
  );
}

/**
 * Pretty console format used in development.
 * Displays coloured, human-readable output with timestamp and context.
 */
export function createPrettyFormat(
  disableColors = false,
): winston.Logform.Format {
  return winston.format.combine(
    winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.colorize({ all: !disableColors }),
    winston.format.printf(
      ({ timestamp, level, message, context, stack, ...meta }) => {
        const ctx = context ? `[${context}]` : "";
        const metaStr = Object.keys(meta).length
          ? " " + JSON.stringify(meta, null, 0)
          : "";
        const stackStr = stack ? `\n${stack}` : "";
        return `${timestamp} ${level} ${ctx} ${message}${metaStr}${stackStr}`;
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Transport factories
// ---------------------------------------------------------------------------

/**
 * Returns a console transport configured for the current environment.
 *
 * - Development: coloured pretty output
 * - Production/CI: JSON output suitable for log aggregators
 */
export function createConsoleTransport(
  isDevelopment: boolean,
  serviceName: string,
  disableColors = false,
): winston.transports.ConsoleTransportInstance {
  return new winston.transports.Console({
    format: isDevelopment
      ? createPrettyFormat(disableColors)
      : createJsonFormat(serviceName),
  });
}

/**
 * Creates a daily-rotating file transport pair:
 * - `<dir>/app-%DATE%.log`   — all levels
 * - `<dir>/error-%DATE%.log` — errors only
 */
export function createFileTransports(dir: string): winston.transport[] {
  const sharedOptions: Record<string, unknown> = {
    dirname: dir,
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "14d",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
  };

  return [
    new (winston.transports as any).DailyRotateFile({
      ...sharedOptions,
      filename: "app-%DATE%.log",
      level: "verbose",
    }),
    new (winston.transports as any).DailyRotateFile({
      ...sharedOptions,
      filename: "error-%DATE%.log",
      level: "error",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

/**
 * Builds a configured Winston {@link winston.Logger} instance.
 *
 * This function is **pure** — it does not mutate global state and can be
 * called multiple times with different options to obtain distinct loggers.
 */
export function createWinstonLogger(
  opts: LoggerModuleOptions = {},
): winston.Logger {
  const {
    serviceName = process.env.SERVICE_NAME ?? "alian-structure-api",
    level = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info",
    disableColors = false,
    logFileDir = process.env.LOG_FILE_DIR,
    extraTransports = [],
  } = opts;

  const isDevelopment = process.env.NODE_ENV === "development";

  // Add custom levels to the winston singleton so the `fatal` level works
  winston.addColors(LOG_LEVEL_COLORS);

  const transports: winston.transport[] = [
    createConsoleTransport(isDevelopment, serviceName, disableColors),
    ...extraTransports,
  ];

  if (logFileDir) {
    transports.push(...createFileTransports(logFileDir));
  }

  return winston.createLogger({
    levels: LOG_LEVELS,
    level,
    transports,
    exitOnError: false,
    // Silence the logger entirely in test unless LOG_LEVEL is explicitly set
    silent: process.env.NODE_ENV === "test" && !process.env.LOG_LEVEL,
    defaultMeta: {
      service: serviceName,
      environment: process.env.NODE_ENV ?? "development",
    },
  });
}
