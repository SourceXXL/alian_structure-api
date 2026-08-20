import {
  retry,
  RetryStrategy,
  calculateDelay,
  isTransientError,
  sleep,
  ConnectionError,
  RetryService,
} from "./retry.service";

describe("retry.service", () => {
  describe("retry", () => {
    it("returns result on first success", async () => {
      const result = await retry(() => Promise.resolve("ok"), {
        maxRetries: 3,
        baseDelay: 0,
        maxDelay: 0,
      });
      expect(result).toBe("ok");
    });

    it("retries on transient errors and eventually succeeds", async () => {
      let attempts = 0;
      const result = await retry(
        () => {
          attempts += 1;
          if (attempts < 3) throw new Error("ECONNREFUSED");
          return Promise.resolve("recovered");
        },
        { maxRetries: 5, baseDelay: 0, maxDelay: 0 },
      );
      expect(result).toBe("recovered");
      expect(attempts).toBe(3);
    });

    it("throws after max retries exceeded", async () => {
      await expect(
        retry(() => Promise.reject(new Error("ECONNREFUSED")), {
          maxRetries: 2,
          baseDelay: 0,
          maxDelay: 0,
        }),
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("does not retry non-transient errors", async () => {
      await expect(
        retry(() => Promise.reject(new Error("ValidationError")), {
          maxRetries: 3,
          baseDelay: 0,
          maxDelay: 0,
        }),
      ).rejects.toThrow("ValidationError");
    });
  });

  describe("calculateDelay", () => {
    it("returns base delay for fixed strategy", () => {
      expect(calculateDelay(RetryStrategy.FIXED_DELAY, 1, 1000, 2, 30000)).toBe(
        1000,
      );
    });

    it("exponentially increases delay", () => {
      const delay0 = calculateDelay(
        RetryStrategy.EXPONENTIAL_BACKOFF,
        0,
        1000,
        2,
        30000,
      );
      const delay1 = calculateDelay(
        RetryStrategy.EXPONENTIAL_BACKOFF,
        1,
        1000,
        2,
        30000,
      );
      expect(delay1).toBe(delay0 * 2);
    });

    it("caps delay at maxDelay", () => {
      const delay = calculateDelay(
        RetryStrategy.EXPONENTIAL_BACKOFF,
        10,
        1000,
        2,
        30000,
      );
      expect(delay).toBe(30000);
    });
  });

  describe("sleep", () => {
    it("resolves after delay", async () => {
      const start = Date.now();
      await sleep(10);
      expect(Date.now() - start).toBeGreaterThanOrEqual(5);
    });
  });

  describe("isTransientError", () => {
    it("identifies transient connection errors", () => {
      expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isTransientError(new Error("ValidationError"))).toBe(false);
    });
  });

  describe("ConnectionError", () => {
    it("creates error with name", () => {
      const err = new ConnectionError("boom");
      expect(err.message).toBe("boom");
      expect(err.name).toBe("ConnectionError");
    });
  });

  describe("RetryService", () => {
    it("timeout rejects after delay", async () => {
      const service = new RetryService();
      await expect(service.timeout(10)).rejects.toThrow("Timed out");
    });
  });
});
