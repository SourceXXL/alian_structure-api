import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { PerformanceInterceptor } from "./performance.interceptor";
import { LoggerService } from "./logger.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(
  className = "TestController",
  methodName = "index",
): ExecutionContext {
  return {
    getClass: () => ({ name: className }),
    getHandler: () => ({ name: methodName }),
    switchToHttp: () => ({
      getRequest: () => ({ requestId: "req-test-123" }),
    }),
  } as unknown as ExecutionContext;
}

function makeCallHandler(value: unknown = { ok: true }): CallHandler {
  return { handle: () => of(value) };
}

function makeErrorHandler(error: Error): CallHandler {
  return { handle: () => throwError(() => error) };
}

function makeLogger(): LoggerService {
  const svc = new LoggerService({ level: "verbose" });
  svc.winstonLogger.clear();
  jest.spyOn(svc, "logPerformance");
  jest.spyOn(svc, "error");
  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PerformanceInterceptor", () => {
  afterEach(() => jest.clearAllMocks());

  describe("normal execution", () => {
    it("passes the response value through unchanged", (done) => {
      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        thresholdMs: 10000,
      });
      const ctx = makeContext();
      const handler = makeCallHandler({ data: "hello" });

      interceptor.intercept(ctx, handler).subscribe({
        next: (value) => {
          expect(value).toEqual({ data: "hello" });
          done();
        },
      });
    });

    it("does NOT log when operation is fast and logAll=false", (done) => {
      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        thresholdMs: 10000,
        logAll: false,
      });
      const ctx = makeContext();

      interceptor.intercept(ctx, makeCallHandler()).subscribe({
        complete: () => {
          expect(logger.logPerformance).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it("logs all operations when logAll=true", (done) => {
      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        thresholdMs: 10000,
        logAll: true,
      });
      const ctx = makeContext();

      interceptor.intercept(ctx, makeCallHandler()).subscribe({
        complete: () => {
          expect(logger.logPerformance).toHaveBeenCalledWith(
            expect.objectContaining({
              operation: "TestController.index",
            }),
          );
          done();
        },
      });
    });
  });

  describe("slow operation detection", () => {
    it("logs a performance metric when duration exceeds threshold", (done) => {
      // Arrange: mock hrtime to simulate 1500ms elapsed
      const bigIntSpy = jest
        .spyOn(process.hrtime, "bigint")
        .mockReturnValueOnce(0n)
        .mockReturnValueOnce(1_500_000_000n); // 1500ms

      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        thresholdMs: 1000,
        logAll: false,
      });
      const ctx = makeContext("PortfolioController", "getOptimization");

      interceptor.intercept(ctx, makeCallHandler()).subscribe({
        complete: () => {
          expect(logger.logPerformance).toHaveBeenCalledWith(
            expect.objectContaining({
              operation: "PortfolioController.getOptimization",
              slow: true,
              threshold: 1000,
            }),
          );
          bigIntSpy.mockRestore();
          done();
        },
      });
    });
  });

  describe("error handling", () => {
    it("logs error details with timing when the handler throws", (done) => {
      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        thresholdMs: 1000,
      });
      const ctx = makeContext("AuthController", "login");
      const err = new Error("DB timeout");
      const handler = makeErrorHandler(err);

      interceptor.intercept(ctx, handler).subscribe({
        error: () => {
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
              message: expect.stringContaining("AuthController.login"),
              error: expect.objectContaining({
                message: "DB timeout",
              }),
            }),
          );
          done();
        },
      });
    });
  });

  describe("disabled mode", () => {
    it("bypasses all logic when enabled=false", (done) => {
      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        enabled: false,
      });
      const ctx = makeContext();

      interceptor.intercept(ctx, makeCallHandler()).subscribe({
        complete: () => {
          expect(logger.logPerformance).not.toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe("request ID extraction", () => {
    it("includes requestId in the performance log entry", (done) => {
      const bigIntSpy = jest
        .spyOn(process.hrtime, "bigint")
        .mockReturnValueOnce(0n)
        .mockReturnValueOnce(2_000_000_000n); // 2000ms

      const logger = makeLogger();
      const interceptor = new PerformanceInterceptor(logger, {
        thresholdMs: 1000,
      });
      const ctx = makeContext();

      interceptor.intercept(ctx, makeCallHandler()).subscribe({
        complete: () => {
          expect(logger.logPerformance).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "req-test-123" }),
          );
          bigIntSpy.mockRestore();
          done();
        },
      });
    });
  });
});
