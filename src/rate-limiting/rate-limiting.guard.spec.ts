import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DistributedRateLimitGuard } from "./rate-limiting.guard";
import { RateLimiterService } from "./rate-limiter.service";
import { RateLimitStrategy } from "./interfaces";

function createMockResponse() {
  return {
    header: jest.fn(),
    setHeader: jest.fn(),
  };
}

function createContext(overrides: Record<string, unknown> = {}): {
  context: ExecutionContext;
  request: any;
  response: { header: jest.Mock; setHeader: jest.Mock };
} {
  const request = {
    ip: "127.0.0.1",
    headers: {},
    user: undefined,
    route: { path: "/api/test" },
    originalUrl: "/api/test",
    url: "/api/test",
    authType: undefined,
    ...overrides,
  };

  const response = createMockResponse();

  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, request, response };
}

function createMockRateLimiter(decision: any): RateLimiterService {
  const mock = {
    consume: jest.fn().mockResolvedValue(decision),
  };
  return mock as any;
}

describe("DistributedRateLimitGuard", () => {
  let guard: DistributedRateLimitGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    const rateLimiter = createMockRateLimiter({
      allowed: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    guard = new DistributedRateLimitGuard(reflector, rateLimiter);
  });

  describe("canActivate", () => {
    it("allows requests within the rate limit", async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it("emits X-RateLimit headers with tier, strategy, and remaining", async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context, response } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await guard.canActivate(context);

      expect(response.header).toHaveBeenCalledWith("X-RateLimit-Limit", 100);
      expect(response.header).toHaveBeenCalledWith("X-RateLimit-Remaining", 99);
      expect(response.header).toHaveBeenCalledWith("X-RateLimit-Tier", "free");
      expect(response.header).toHaveBeenCalledWith(
        "X-RateLimit-Strategy",
        RateLimitStrategy.TokenBucket,
      );
    });

    it("throws 429 when rate limit is exceeded", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
        retryAfterMs: 30_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      try {
        await guard.canActivate(context);
      } catch (error) {
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const body = httpError.getResponse() as any;
        expect(body.statusCode).toBe(429);
        expect(body.retryAfter).toBeDefined();
        expect(body.strategy).toBeDefined();
      }
    });

    it("sets Retry-After header on denial", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterMs: 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context, response } = createContext({
        user: { id: "user-1", role: "user" },
      });

      try {
        await guard.canActivate(context);
      } catch {
        // expected
      }

      expect(response.header).toHaveBeenCalledWith("Retry-After", 60);
    });

    it("resolves enterprise tier for admin users", async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context, response } = createContext({
        user: { id: "user-1", role: "admin" },
      });

      await guard.canActivate(context);

      expect(response.header).toHaveBeenCalledWith(
        "X-RateLimit-Tier",
        "enterprise",
      );
    });

    it("resolves paid tier for operator users", async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context, response } = createContext({
        user: { id: "user-2", role: "operator" },
      });

      await guard.canActivate(context);

      expect(response.header).toHaveBeenCalledWith("X-RateLimit-Tier", "paid");
    });

    it("resolves enterprise tier for api-key auth", async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context, response } = createContext({
        authType: "api-key",
      });

      await guard.canActivate(context);

      expect(response.header).toHaveBeenCalledWith(
        "X-RateLimit-Tier",
        "enterprise",
      );
    });

    it("uses explicit user tier when provided", async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context, response } = createContext({
        user: { id: "user-3", tier: "enterprise" },
      });

      await guard.canActivate(context);

      expect(response.header).toHaveBeenCalledWith(
        "X-RateLimit-Tier",
        "enterprise",
      );
    });

    it("passes strategy from decorator options", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 49,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue({
        level: undefined,
        limit: 50,
        windowMs: 60_000,
        burst: 50,
        strategy: RateLimitStrategy.SlidingWindow,
      });

      const { context, response } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await guard.canActivate(context);

      const consumeCall = (rateLimiter as any).consume as jest.Mock;
      expect(consumeCall).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          strategy: RateLimitStrategy.SlidingWindow,
        }),
        "user:user-1",
        "/api/test",
        "free",
      );
      expect(response.header).toHaveBeenCalledWith(
        "X-RateLimit-Strategy",
        RateLimitStrategy.SlidingWindow,
      );
    });

    it("uses custom key from decorator options as scope", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue({
        level: "custom",
        limit: 100,
        windowMs: 60_000,
        burst: 120,
        key: "my-custom-scope",
      });

      const { context } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await guard.canActivate(context);

      const consumeCall = (rateLimiter as any).consume as jest.Mock;
      const keyArg = consumeCall.mock.calls[0][0];
      const scopeArg = consumeCall.mock.calls[0][3];
      expect(keyArg).toContain("my-custom-scope");
      expect(scopeArg).toBe("my-custom-scope");
    });

    it("tracks request tracker from IP when no user", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context } = createContext({
        user: undefined,
        ip: "10.0.0.1",
      });

      await guard.canActivate(context);

      const consumeCall = (rateLimiter as any).consume as jest.Mock;
      const trackerArg = consumeCall.mock.calls[0][2];
      expect(trackerArg).toBe("ip:10.0.0.1");
    });

    it("extracts first IP from X-Forwarded-For", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context } = createContext({
        user: undefined,
        headers: { "x-forwarded-for": "203.0.113.5, 192.168.1.1" },
      });

      await guard.canActivate(context);

      const consumeCall = (rateLimiter as any).consume as jest.Mock;
      const trackerArg = consumeCall.mock.calls[0][2];
      expect(trackerArg).toBe("ip:203.0.113.5");
    });

    it("handles missing user and IP gracefully", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
      const { context } = createContext({
        user: undefined,
        headers: {},
        ip: undefined,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);

      const consumeCall = (rateLimiter as any).consume as jest.Mock;
      const trackerArg = consumeCall.mock.calls[0][2];
      expect(trackerArg).toBe("ip:unknown");
    });

    it("warns when approaching the rate limit", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 5,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);
      const warnSpy = jest.spyOn(guard["logger"], "warn").mockImplementation();

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue({
        level: undefined,
        limit: 50,
        windowMs: 60_000,
        burst: 60,
      });

      const { context } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await guard.canActivate(context);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("does not warn when remaining is high", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 90,
        resetAt: Date.now() + 60_000,
      });
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);
      const warnSpy = jest.spyOn(guard["logger"], "warn").mockImplementation();

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue({
        level: undefined,
        limit: 100,
        windowMs: 60_000,
        burst: 120,
      });

      const { context } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await guard.canActivate(context);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
