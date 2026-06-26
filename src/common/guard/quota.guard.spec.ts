import {
  ExecutionContext,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { QuotaGuard } from "./quota.guard";

function createContext(options?: {
  user?: { id?: string; sub?: string; address?: string; role?: string; tier?: string; type?: string };
  ip?: string;
  originalUrl?: string;
}): { context: ExecutionContext; response: { header: jest.Mock; setHeader: jest.Mock } } {
  const request = {
    ip: options?.ip ?? "127.0.0.1",
    headers: {},
    originalUrl: options?.originalUrl ?? "/api/test",
    route: { path: "/api/test" },
    authType: options?.user?.type,
    user: options?.user,
  };

  const response = {
    header: jest.fn(),
    setHeader: jest.fn(),
  };

  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, response };
}

describe("QuotaGuard", () => {
  let guard: QuotaGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new QuotaGuard(reflector);
  });

  it("allows requests and emits rate-limit headers for the default tier", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    const { context, response } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.header).toHaveBeenCalledWith("X-RateLimit-Limit", 100);
    expect(response.header).toHaveBeenCalledWith(
      "X-RateLimit-Remaining",
      99,
    );
    expect(response.header).toHaveBeenCalledWith("X-RateLimit-Tier", "free");
  });

  it("uses the authenticated user tier when one is available", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    const { context, response } = createContext({
      user: { id: "user-1", role: "admin" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.header).toHaveBeenCalledWith(
      "X-RateLimit-Tier",
      "enterprise",
    );
  });

  it("rejects requests after the configured limit is reached", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue({
      level: "auth",
      limit: 1,
      windowMs: 60_000,
    });

    const { context } = createContext({
      user: { id: "user-2", role: "user" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    try {
      await guard.canActivate(context);
      throw new Error("Expected rate limit rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});
