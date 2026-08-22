import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { PaymentStatus } from "../../interfaces/payment-processor.interface";
import { GrantfoxAdapter } from "./grantfox.adapter";

const API_URL = "https://api.grantfox.example";
const API_KEY = "secret-key";

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const env: Record<string, string> = {
    GRANTFOX_API_URL: API_URL,
    GRANTFOX_API_KEY: API_KEY,
    ...overrides,
  };
  return {
    get: jest.fn((key: string, def?: unknown) => env[key] ?? def),
  } as unknown as ConfigService;
}

describe("GrantfoxAdapter", () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let adapter: GrantfoxAdapter;

  beforeEach(() => {
    http = { post: jest.fn(), get: jest.fn() };
    adapter = new GrantfoxAdapter(http as unknown as HttpService, makeConfig());
  });

  it("advertises its identity", () => {
    expect(adapter.name).toBe("grantfox");
    expect(adapter.displayName).toBe("Grantfox");
  });

  describe("createPayment", () => {
    it("POSTs to /payments with auth + idempotency headers and maps the response", async () => {
      http.post.mockReturnValue(
        of({ data: { id: "gf_123", status: "processing" } }),
      );

      const created = await adapter.createPayment({
        amount: "25.50",
        currency: "USD",
        destination: "acct_1",
        idempotencyKey: "idem-1",
      });

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = http.post.mock.calls[0];
      expect(url).toBe(`${API_URL}/payments`);
      expect(body).toMatchObject({ amount: "25.50", currency: "USD" });
      expect(config.headers.Authorization).toBe(`Bearer ${API_KEY}`);
      expect(config.headers["Idempotency-Key"]).toBe("idem-1");

      expect(created.paymentId).toBe("gf_123");
      expect(created.status).toBe(PaymentStatus.PROCESSING);
    });

    it("throws ServiceUnavailable when the API URL is not configured", async () => {
      const unconfigured = new GrantfoxAdapter(
        http as unknown as HttpService,
        makeConfig({ GRANTFOX_API_URL: "" }),
      );

      await expect(
        unconfigured.createPayment({
          amount: "1",
          currency: "USD",
          destination: "acct_1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("GETs /payments/:id and maps status + hash", async () => {
      http.get.mockReturnValue(
        of({
          data: {
            id: "gf_123",
            status: "confirmed",
            transactionHash: "0xabc",
            amount: "25.50",
          },
        }),
      );

      const status = await adapter.getStatus("gf_123");

      expect(http.get).toHaveBeenCalledWith(
        `${API_URL}/payments/gf_123`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${API_KEY}`,
          }),
        }),
      );
      expect(status.status).toBe(PaymentStatus.CONFIRMED);
      expect(status.transactionHash).toBe("0xabc");
    });
  });

  describe("refund", () => {
    it("POSTs a full refund and maps REFUNDED", async () => {
      http.post.mockReturnValue(
        of({ data: { refundId: "rf_1", status: "refunded", amount: "25.50" } }),
      );

      const result = await adapter.refund({
        paymentId: "gf_123",
        idempotencyKey: "r-1",
      });

      const [url, body] = http.post.mock.calls[0];
      expect(url).toBe(`${API_URL}/payments/gf_123/refund`);
      expect(body).not.toHaveProperty("amount");
      expect(result.status).toBe(PaymentStatus.REFUNDED);
      expect(result.refundId).toBe("rf_1");
    });

    it("forwards a partial amount in the refund body", async () => {
      http.post.mockReturnValue(
        of({
          data: { refundId: "rf_2", status: "partially_refunded", amount: "5" },
        }),
      );

      const result = await adapter.refund({
        paymentId: "gf_123",
        amount: "5",
        idempotencyKey: "r-2",
      });

      const [, body] = http.post.mock.calls[0];
      expect(body).toMatchObject({ amount: "5" });
      expect(result.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(result.refundedAmount).toBe("5");
    });
  });

  describe("error mapping", () => {
    it("maps a 4xx upstream error to BadRequest", async () => {
      http.post.mockReturnValue(
        throwError(() => ({
          response: { status: 422, data: { message: "invalid destination" } },
          message: "Request failed with status code 422",
        })),
      );

      await expect(
        adapter.createPayment({
          amount: "1",
          currency: "USD",
          destination: "bad",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("maps a 5xx upstream error to ServiceUnavailable", async () => {
      http.get.mockReturnValue(
        throwError(() => ({
          response: { status: 503, data: {} },
          message: "Service Unavailable",
        })),
      );

      await expect(adapter.getStatus("gf_123")).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
