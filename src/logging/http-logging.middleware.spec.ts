import { EventEmitter } from "events";
import { HttpLoggingMiddleware } from "./http-logging.middleware";
import { LoggerService } from "./logger.service";

// ---------------------------------------------------------------------------
// Helpers — minimal mock Request / Response / NextFunction
// ---------------------------------------------------------------------------

function makeReq(
  overrides: Partial<{
    method: string;
    path: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    body: Record<string, unknown>;
    ip: string;
  }> = {},
) {
  return {
    method: overrides.method ?? "GET",
    path: overrides.path ?? "/api/v1/test",
    headers: overrides.headers ?? { "content-type": "application/json" },
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    ip: overrides.ip ?? "127.0.0.1",
  };
}

function makeRes(statusCode = 200) {
  const emitter = new EventEmitter() as any;
  emitter.statusCode = statusCode;
  emitter.setHeader = jest.fn();
  emitter.getHeader = jest.fn().mockReturnValue("512");
  emitter.setHeader = jest.fn();
  return emitter;
}

function makeLogger(): LoggerService {
  const svc = new LoggerService({ level: "verbose" });
  svc.winstonLogger.clear(); // no console output during tests
  // Spy on all log-level methods
  jest.spyOn(svc, "info");
  jest.spyOn(svc, "warn");
  jest.spyOn(svc, "error");
  jest.spyOn(svc, "debug");
  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HttpLoggingMiddleware", () => {
  afterEach(() => jest.clearAllMocks());

  describe("request logging", () => {
    it("logs the incoming request at info level for normal routes", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({ method: "POST", path: "/api/v1/auth/login" });
      const res = makeRes(200);
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("POST /api/v1/auth/login"),
          context: "HttpLogging",
        }),
      );
      expect(next).toHaveBeenCalled();
    });

    it("sets x-request-id header on the response", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq();
      const res = makeRes();
      middleware.use(req as any, res as any, jest.fn());
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-request-id",
        expect.any(String),
      );
    });

    it("propagates x-request-id from the incoming request header", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({
        headers: { "x-request-id": "my-custom-id" },
      });
      const res = makeRes();
      middleware.use(req as any, res as any, jest.fn());
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-request-id",
        "my-custom-id",
      );
    });
  });

  describe("response logging", () => {
    it("logs the response after 'finish' fires at info level for 2xx", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq();
      const res = makeRes(200);
      middleware.use(req as any, res as any, jest.fn());
      res.emit("finish");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("200"),
          context: "HttpLogging",
        }),
      );
    });

    it("logs at warn level for 4xx responses", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq();
      const res = makeRes(404);
      middleware.use(req as any, res as any, jest.fn());
      res.emit("finish");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("404"),
        }),
      );
    });

    it("logs at error level for 5xx responses", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq();
      const res = makeRes(500);
      middleware.use(req as any, res as any, jest.fn());
      res.emit("finish");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("500"),
        }),
      );
    });
  });

  describe("slow request detection", () => {
    it("logs a slow request warning when latency exceeds 1 second", () => {
      jest.useFakeTimers();
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({ path: "/api/v1/compute/heavy" });
      const res = makeRes(200);

      // Mock process.hrtime to simulate a 1.5 second elapsed time
      const bigIntSpy = jest
        .spyOn(process.hrtime, "bigint")
        .mockReturnValueOnce(0n) // start
        .mockReturnValueOnce(1_500_000_000n); // finish (1500ms)

      middleware.use(req as any, res as any, jest.fn());
      res.emit("finish");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Slow request"),
        }),
      );

      bigIntSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe("sensitive data sanitization", () => {
    it("redacts Authorization header in logged request", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({
        headers: { authorization: "Bearer super-secret-token" },
      });
      const res = makeRes();
      middleware.use(req as any, res as any, jest.fn());

      const calls = (logger.info as jest.Mock).mock.calls;
      const logged = JSON.stringify(calls);
      expect(logged).not.toContain("super-secret-token");
    });

    it("redacts password fields in request body", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({
        method: "POST",
        path: "/api/v1/auth/register",
        body: { email: "alice@example.com", password: "hunter2" },
        headers: { "content-length": "50" },
      });
      const res = makeRes(201);
      middleware.use(req as any, res as any, jest.fn());

      const calls = (logger.info as jest.Mock).mock.calls;
      const logged = JSON.stringify(calls);
      expect(logged).not.toContain("hunter2");
    });
  });

  describe("route level overrides", () => {
    it("logs health checks at debug level", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({ path: "/health" });
      const res = makeRes(200);
      middleware.use(req as any, res as any, jest.fn());

      // info should NOT be called for /health routes
      const infoCalls = (logger.info as jest.Mock).mock.calls;
      const calledWithHealth = infoCalls.some((c) =>
        JSON.stringify(c).includes("/health"),
      );
      expect(calledWithHealth).toBe(false);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("/health"),
        }),
      );
    });

    it("silences /metrics route entirely", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger);
      const req = makeReq({ path: "/metrics" });
      const res = makeRes(200);
      middleware.use(req as any, res as any, jest.fn());

      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe("resolveLevel", () => {
    it("returns info for unknown paths", () => {
      const middleware = new HttpLoggingMiddleware(makeLogger());
      expect(middleware.resolveLevel("/api/v1/portfolio")).toBe("info");
    });

    it("returns debug for /health paths", () => {
      const middleware = new HttpLoggingMiddleware(makeLogger());
      expect(middleware.resolveLevel("/health")).toBe("debug");
    });

    it("returns silent for /metrics paths", () => {
      const middleware = new HttpLoggingMiddleware(makeLogger());
      expect(middleware.resolveLevel("/metrics")).toBe("silent");
    });
  });

  describe("responseLevel", () => {
    let middleware: HttpLoggingMiddleware;
    beforeEach(() => {
      middleware = new HttpLoggingMiddleware(makeLogger());
    });

    it("returns error for 5xx", () => {
      expect(middleware.responseLevel(500, "info")).toBe("error");
      expect(middleware.responseLevel(503, "info")).toBe("error");
    });

    it("returns warn for 4xx", () => {
      expect(middleware.responseLevel(400, "info")).toBe("warn");
      expect(middleware.responseLevel(404, "info")).toBe("warn");
      expect(middleware.responseLevel(403, "info")).toBe("warn");
    });

    it("returns the route level for 2xx/3xx", () => {
      expect(middleware.responseLevel(200, "info")).toBe("info");
      expect(middleware.responseLevel(301, "debug")).toBe("debug");
    });

    it("returns silent when route level is silent", () => {
      expect(middleware.responseLevel(200, "silent")).toBe("silent");
      expect(middleware.responseLevel(500, "silent")).toBe("silent");
    });
  });

  describe("maybeBody", () => {
    it("returns undefined for empty bodies", () => {
      const middleware = new HttpLoggingMiddleware(makeLogger());
      const req = makeReq({ body: {} });
      expect(middleware.maybeBody(req as any)).toBeUndefined();
    });

    it("returns a placeholder when Content-Length exceeds the limit", () => {
      const middleware = new HttpLoggingMiddleware(makeLogger());
      const req = makeReq({
        body: { data: "x" },
        headers: { "content-length": "20000" }, // > 10KB default
      });
      const result = middleware.maybeBody(req as any);
      expect(result).toMatch(/BODY_TOO_LARGE/);
    });
  });

  describe("disabled mode", () => {
    it("calls next() without logging anything when enabled=false", () => {
      const logger = makeLogger();
      const middleware = new HttpLoggingMiddleware(logger, { enabled: false });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
