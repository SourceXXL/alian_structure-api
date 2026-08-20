import { Writable } from "stream";
import * as winston from "winston";
import { LoggerService, ScopedLoggerService } from "./logger.service";
import { createWinstonLogger } from "./winston.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a LoggerService that writes to an in-memory array instead of
 * console / file transports.  Allows tests to inspect emitted log records
 * without touching stdout or the filesystem.
 */
function createTestLoggerService(): {
  service: LoggerService;
  records: Array<{
    level: string;
    message: string;
    meta: Record<string, unknown>;
  }>;
} {
  const records: Array<{
    level: string;
    message: string;
    meta: Record<string, unknown>;
  }> = [];

  // Create a minimal logger with a custom transport that captures to `records`
  // Use a synchronous Writable so writes land in `records` before any setTimeout fires.
  const captureStream = new Writable({
    write(chunk: Buffer | string, _encoding: string, callback: () => void) {
      try {
        const parsed = JSON.parse(chunk.toString());
        const { level, message, ...meta } = parsed;
        records.push({ level, message, meta });
      } catch {
        // ignore non-JSON
      }
      callback();
    },
  });

  const transport = new winston.transports.Stream({
    stream: captureStream,
  });

  // Inject via a slightly different approach: override the winstonLogger
  const service = new LoggerService({ level: "verbose" });

  // Replace all transports with our capturing transport.
  // Also clear the `silent` flag that createWinstonLogger sets when
  // NODE_ENV==="test" — without this, no writes reach the transport.
  service.winstonLogger.clear();
  service.winstonLogger.silent = false;
  service.winstonLogger.add(transport);
  service.winstonLogger.format = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  );

  return { service, records };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoggerService", () => {
  describe("NestJS LoggerService interface", () => {
    it("is instantiable with no options", () => {
      const svc = new LoggerService();
      expect(svc).toBeDefined();
    });

    it("exposes a winstonLogger instance", () => {
      const svc = new LoggerService();
      expect(svc.winstonLogger).toBeDefined();
    });

    it("implements all NestJS LoggerService methods", () => {
      const svc = new LoggerService();
      expect(typeof svc.log).toBe("function");
      expect(typeof svc.error).toBe("function");
      expect(typeof svc.warn).toBe("function");
      expect(typeof svc.debug).toBe("function");
      expect(typeof svc.verbose).toBe("function");
    });
  });

  describe("structured logging", () => {
    it("logs an info entry without throwing", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear(); // silence console output in tests
      expect(() => svc.info("test message")).not.toThrow();
    });

    it("logs an error entry without throwing", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      expect(() => svc.error("test error")).not.toThrow();
    });

    it("logs a warn entry without throwing", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      expect(() => svc.warn("test warn")).not.toThrow();
    });

    it("logs a fatal entry without throwing", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      expect(() => svc.fatal("critical failure")).not.toThrow();
    });
  });

  describe("sensitive data sanitization", () => {
    it("redacts password fields from metadata", () => {
      const { service, records } = createTestLoggerService();

      service.info({
        message: "User login attempt",
        context: "Auth",
        credentials: { username: "alice", password: "s3cret!" },
      });

      // Wait for async writes
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const record = records[0];
          expect(record).toBeDefined();
          // The password should never appear in raw form
          expect(JSON.stringify(record)).not.toContain("s3cret!");
          resolve();
        }, 50);
      });
    });

    it("redacts token fields from metadata", () => {
      const { service, records } = createTestLoggerService();

      service.info({
        message: "Token refresh",
        context: "Auth",
        refreshToken: "super-secret-token",
        accessToken: "access-abc",
      });

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const serialized = JSON.stringify(records);
          expect(serialized).not.toContain("super-secret-token");
          expect(serialized).not.toContain("access-abc");
          resolve();
        }, 50);
      });
    });
  });

  describe("logError", () => {
    it("logs Error objects with type and message", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      const err = new Error("something went wrong");
      expect(() => svc.logError(err, "TestContext")).not.toThrow();
    });

    it("handles non-Error values gracefully", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      expect(() => svc.logError("string error", "TestContext")).not.toThrow();
      expect(() => svc.logError(42, "TestContext")).not.toThrow();
    });
  });

  describe("logPerformance", () => {
    it("logs performance metrics without throwing", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      expect(() =>
        svc.logPerformance({
          operation: "Portfolio.calculateReturns",
          durationMs: 1234.5,
          requestId: "req-123",
        }),
      ).not.toThrow();
    });
  });

  describe("forContext", () => {
    it("returns a ScopedLoggerService instance", () => {
      const svc = new LoggerService();
      const scoped = svc.forContext("MyComponent");
      expect(scoped).toBeInstanceOf(ScopedLoggerService);
    });

    it("scoped logger delegates to parent without throwing", () => {
      const svc = new LoggerService({ level: "verbose" });
      svc.winstonLogger.clear();
      const scoped = svc.forContext("MyModule");

      expect(() => scoped.log("scoped info")).not.toThrow();
      expect(() => scoped.error("scoped error")).not.toThrow();
      expect(() => scoped.warn("scoped warn")).not.toThrow();
      expect(() => scoped.debug("scoped debug")).not.toThrow();
      expect(() => scoped.verbose("scoped verbose")).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// ScopedLoggerService
// ---------------------------------------------------------------------------

describe("ScopedLoggerService", () => {
  it("forwards logError to parent with context", () => {
    const parent = new LoggerService({ level: "verbose" });
    parent.winstonLogger.clear();
    const logErrorSpy = jest.spyOn(parent, "logError");

    const scoped = new ScopedLoggerService(parent, "TestScope");
    const err = new Error("scoped error");
    scoped.logError(err, { userId: "u1" });

    expect(logErrorSpy).toHaveBeenCalledWith(err, "TestScope", {
      userId: "u1",
    });
  });

  it("forwards logPerformance to parent with context injected", () => {
    const parent = new LoggerService({ level: "verbose" });
    parent.winstonLogger.clear();
    const perfSpy = jest.spyOn(parent, "logPerformance");

    const scoped = new ScopedLoggerService(parent, "MyService");
    scoped.logPerformance({
      operation: "expensiveOp",
      durationMs: 2500,
    });

    expect(perfSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "expensiveOp",
        durationMs: 2500,
        context: "MyService",
      }),
    );
  });
});
