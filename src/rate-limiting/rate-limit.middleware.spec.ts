import { HttpStatus } from "@nestjs/common";
import { RateLimitMiddleware } from "./rate-limit.middleware";
import { RateLimiterService } from "./rate-limiter.service";
import { RateLimitStrategy } from "./interfaces";

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, any>,
    setHeader: jest.fn((key: string, val: any) => {
      res.headers[key] = val;
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((data: any) => {
      res.body = data;
      return res;
    }),
  };
  return res;
}

describe("RateLimitMiddleware", () => {
  let middleware: RateLimitMiddleware;
  let rateLimiter: RateLimiterService;

  beforeEach(() => {
    rateLimiter = new RateLimiterService(null, {
      keyPrefix: "alian:rl:",
      defaultStrategy: RateLimitStrategy.TokenBucket,
      enableFallback: true,
    });
    middleware = new RateLimitMiddleware(rateLimiter);
  });

  it("calls next() for normal allowed requests", async () => {
    const req: any = {
      headers: {},
      ip: "10.0.0.1",
      method: "GET",
      originalUrl: "/api/v1/data",
    };
    const res = createMockResponse();
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 100);
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Tier", "free");
  });

  it("blocks blacklisted client with 403 Forbidden", async () => {
    await rateLimiter.addBlacklist({
      type: "ip",
      value: "10.0.0.99",
      reason: "malicious",
    });

    const req: any = {
      headers: {},
      ip: "10.0.0.99",
      method: "POST",
      originalUrl: "/api/v1/login",
    };
    const res = createMockResponse();
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
      }),
    );
  });

  it("bypasses rate limiting for whitelisted client", async () => {
    await rateLimiter.addWhitelist({
      type: "ip",
      value: "192.168.1.50",
    });

    const req: any = {
      headers: {},
      ip: "192.168.1.50",
      method: "GET",
      originalUrl: "/api/v1/data",
    };
    const res = createMockResponse();
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Whitelisted", "true");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const req: any = {
      headers: {},
      ip: "10.0.0.2",
      method: "GET",
      originalUrl: "/api/v1/test-limit",
    };

    rateLimiter.addEndpointRule({
      pathPattern: "/api/v1/test-limit",
      limit: 1,
      windowMs: 60000,
    });

    const res1 = createMockResponse();
    const next1 = jest.fn();
    await middleware.use(req, res1, next1);
    expect(next1).toHaveBeenCalled();

    const res2 = createMockResponse();
    const next2 = jest.fn();
    await middleware.use(req, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: "Rate limit exceeded",
      }),
    );
  });
});
