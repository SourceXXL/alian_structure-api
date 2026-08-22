import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Account, Keypair, Networks } from "@stellar/stellar-sdk";
import { of } from "rxjs";
import {
  CreatedPayment,
  IPaymentProcessor,
  PaymentRequest,
  PaymentStatus,
} from "../../interfaces/payment-processor.interface";
import { GrantfoxAdapter } from "../grantfox/grantfox.adapter";
import { StellarAdapter } from "../stellar/stellar.adapter";

/**
 * Contract-compliance suite. Every adapter is driven through the full
 * create → sign → submit → getStatus → refund lifecycle against *mocked*
 * network clients, and each step's result is type/shape-checked against
 * {@link IPaymentProcessor}. Adding a new adapter here is the one place that
 * proves it honours the contract.
 */

const VALID_STATUSES = new Set<string>(Object.values(PaymentStatus));

interface AdapterCase {
  name: string;
  build: () => IPaymentProcessor;
  request: PaymentRequest;
}

function stellarCase(): AdapterCase {
  const signingKp = Keypair.random();
  const payerKp = Keypair.random();
  const destKp = Keypair.random();

  const build = (): IPaymentProcessor => {
    const call = jest
      .fn()
      .mockResolvedValue({ hash: "TXHASH", successful: true });
    const server = {
      loadAccount: jest
        .fn()
        .mockResolvedValue(new Account(payerKp.publicKey(), "100")),
      submitTransaction: jest
        .fn()
        .mockResolvedValue({ hash: "TXHASH", successful: true }),
      transactions: jest
        .fn()
        .mockReturnValue({ transaction: jest.fn().mockReturnValue({ call }) }),
      payments: jest.fn().mockReturnValue({
        forTransaction: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({
            records: [
              {
                type: "payment",
                amount: "10",
                from: payerKp.publicKey(),
                to: signingKp.publicKey(),
                asset_type: "native",
              },
            ],
          }),
        }),
      }),
    };
    const config = {
      get: jest.fn((key: string, def?: unknown) =>
        key === "STELLAR_NETWORK_PASSPHRASE"
          ? Networks.TESTNET
          : key === "STELLAR_SIGNING_SECRET"
            ? signingKp.secret()
            : def,
      ),
    } as unknown as ConfigService;
    return new StellarAdapter(server as any, config);
  };

  return {
    name: "StellarAdapter",
    build,
    request: {
      amount: "10",
      currency: "XLM",
      destination: destKp.publicKey(),
      source: payerKp.publicKey(),
      idempotencyKey: "idem-stellar",
    },
  };
}

function grantfoxCase(): AdapterCase {
  const build = (): IPaymentProcessor => {
    const http = {
      post: jest.fn((url: string) =>
        of(
          url.endsWith("/refund")
            ? { data: { refundId: "rf_1", status: "refunded", amount: "10" } }
            : { data: { id: "gf_1", status: "processing" } },
        ),
      ),
      get: jest.fn(() =>
        of({
          data: {
            id: "gf_1",
            status: "confirmed",
            transactionHash: "0xabc",
            amount: "10",
          },
        }),
      ),
    };
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        const env: Record<string, string> = {
          GRANTFOX_API_URL: "https://api.grantfox.example",
          GRANTFOX_API_KEY: "key",
        };
        return env[key] ?? def;
      }),
    } as unknown as ConfigService;
    return new GrantfoxAdapter(http as unknown as HttpService, config);
  };

  return {
    name: "GrantfoxAdapter",
    build,
    request: {
      amount: "10",
      currency: "USD",
      destination: "acct_1",
      idempotencyKey: "idem-grantfox",
    },
  };
}

const cases = [stellarCase(), grantfoxCase()];

describe.each(cases)("IPaymentProcessor contract: $name", (testCase) => {
  let adapter: IPaymentProcessor;

  beforeEach(() => {
    adapter = testCase.build();
  });

  it("exposes the full interface surface", () => {
    expect(typeof adapter.name).toBe("string");
    expect(typeof adapter.displayName).toBe("string");
    expect(adapter.capabilities).toEqual(
      expect.objectContaining({
        supportsPartialRefund: expect.any(Boolean),
        requiresClientSideSigning: expect.any(Boolean),
        currencies: expect.any(Array),
      }),
    );
    for (const method of [
      "initialize",
      "createPayment",
      "signTransaction",
      "submitTransaction",
      "getStatus",
      "refund",
    ] as const) {
      expect(typeof adapter[method]).toBe("function");
    }
  });

  it("runs a create → sign → submit → status → refund round-trip with typed results", async () => {
    const created: CreatedPayment = await adapter.createPayment(
      testCase.request,
    );
    expect(typeof created.paymentId).toBe("string");
    expect(VALID_STATUSES.has(created.status)).toBe(true);

    const signed = await adapter.signTransaction(created);
    expect(signed.paymentId).toBe(created.paymentId);
    expect(typeof signed.signedPayload).toBe("string");

    const submitted = await adapter.submitTransaction(signed);
    expect(typeof submitted.transactionHash).toBe("string");
    expect(VALID_STATUSES.has(submitted.status)).toBe(true);

    const status = await adapter.getStatus(submitted.transactionHash);
    expect(VALID_STATUSES.has(status.status)).toBe(true);

    const refund = await adapter.refund({
      paymentId: submitted.transactionHash,
      idempotencyKey: "refund-key",
    });
    expect(typeof refund.refundId).toBe("string");
    expect(typeof refund.refundedAmount).toBe("string");
    expect([
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
    ]).toContain(refund.status);
  });

  it("initialize() resolves without throwing", async () => {
    await expect(adapter.initialize()).resolves.toBeUndefined();
  });
});
