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
    isBlacklisted: jest.fn().mockResolvedValue(false),
    isWhitelisted: jest.fn().mockResolvedValue(false),
    recordViolation: jest.fn().mockResolvedValue({}),
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

      const { context } = createContext({
        user: { id: "user-1", role: "user" },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });

    it("throws 403 when client is blacklisted", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60_000,
      });
      rateLimiter.isBlacklisted = jest.fn().mockResolvedValue(true);
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      const { context } = createContext({
        user: { id: "user-blocked" },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      expect(rateLimiter.recordViolation).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "blacklisted" }),
      );
    });

    it("bypasses rate limiter when client is whitelisted", async () => {
      const rateLimiter = createMockRateLimiter({
        allowed: false,
        remaining: 0,
        resetAt: Date.now(),
      });
      rateLimiter.isWhitelisted = jest.fn().mockResolvedValue(true);
      guard = new DistributedRateLimitGuard(reflector, rateLimiter);

      const { context, response } = createContext({
        user: { id: "user-vip" },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(response.header).toHaveBeenCalledWith(
        "X-RateLimit-Whitelisted",
        "true",
      );
      expect(rateLimiter.consume).not.toHaveBeenCalled();
    });
  });
});
