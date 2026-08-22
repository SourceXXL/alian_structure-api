import {
  PreconditionFailedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { PaymentStatus } from "../../interfaces/payment-processor.interface";
import { StellarAdapter } from "./stellar.adapter";

/** A chainable Horizon call stub: `.transaction(id).call()` / `.forTransaction(id).call()`. */
function callChain(result: unknown) {
  const call = jest.fn().mockResolvedValue(result);
  return {
    transaction: jest.fn().mockReturnValue({ call }),
    forTransaction: jest.fn().mockReturnValue({ call }),
    call,
  };
}

describe("StellarAdapter", () => {
  const signingKp = Keypair.random();
  const payerKp = Keypair.random();
  const destKp = Keypair.random();

  let server: {
    loadAccount: jest.Mock;
    submitTransaction: jest.Mock;
    transactions: jest.Mock;
    payments: jest.Mock;
  };
  let adapter: StellarAdapter;

  const config = {
    get: jest.fn((key: string, def?: unknown) => {
      const env: Record<string, unknown> = {
        STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
        STELLAR_SIGNING_SECRET: signingKp.secret(),
      };
      return env[key] ?? def;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    server = {
      loadAccount: jest
        .fn()
        .mockResolvedValue(new Account(payerKp.publicKey(), "100")),
      submitTransaction: jest.fn(),
      transactions: jest.fn(),
      payments: jest.fn(),
    };
    adapter = new StellarAdapter(server as any, config);
  });

  it("advertises its identity and capabilities", () => {
    expect(adapter.name).toBe("stellar");
    expect(adapter.capabilities.requiresClientSideSigning).toBe(false);
    expect(adapter.capabilities.supportsPartialRefund).toBe(true);
  });

  describe("createPayment", () => {
    it("loads the source account and returns valid unsigned XDR", async () => {
      const created = await adapter.createPayment({
        amount: "10",
        currency: "XLM",
        destination: destKp.publicKey(),
        source: payerKp.publicKey(),
        reference: "invoice-1",
        idempotencyKey: "idem-1",
      });

      expect(server.loadAccount).toHaveBeenCalledWith(payerKp.publicKey());
      expect(created.status).toBe(PaymentStatus.PENDING);
      expect(typeof created.unsignedTransaction).toBe("string");
      // XDR must round-trip back into a transaction.
      expect(() =>
        TransactionBuilder.fromXdr(
          created.unsignedTransaction as string,
          Networks.TESTNET,
        ),
      ).not.toThrow();
    });

    it("maps Horizon load failures to ServiceUnavailable", async () => {
      server.loadAccount.mockRejectedValue(new Error("not found"));
      await expect(
        adapter.createPayment({
          amount: "10",
          currency: "XLM",
          destination: destKp.publicKey(),
          source: payerKp.publicKey(),
          idempotencyKey: "idem-1",
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe("signTransaction", () => {
    it("signs the unsigned XDR with the configured secret", async () => {
      const created = await adapter.createPayment({
        amount: "10",
        currency: "XLM",
        destination: destKp.publicKey(),
        source: payerKp.publicKey(),
        idempotencyKey: "idem-1",
      });

      const signed = await adapter.signTransaction(created);

      expect(signed.signerAddress).toBe(signingKp.publicKey());
      const tx = TransactionBuilder.fromXdr(
        signed.signedPayload,
        Networks.TESTNET,
      );
      expect(tx.signatures.length).toBeGreaterThan(0);
    });

    it("throws when no signing secret is configured", async () => {
      const noSecret = new StellarAdapter(
        server as any,
        {
          get: jest.fn((_key: string, def?: unknown) => def),
        } as unknown as ConfigService,
      );

      await expect(
        noSecret.signTransaction({
          paymentId: "p",
          status: PaymentStatus.PENDING,
          unsignedTransaction: "irrelevant",
        }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });
  });

  describe("submitTransaction", () => {
    async function signedPayload(): Promise<string> {
      const created = await adapter.createPayment({
        amount: "10",
        currency: "XLM",
        destination: destKp.publicKey(),
        source: payerKp.publicKey(),
        idempotencyKey: "idem-1",
      });
      return (await adapter.signTransaction(created)).signedPayload;
    }

    it("returns the hash and CONFIRMED on success", async () => {
      server.submitTransaction.mockResolvedValue({
        hash: "TXHASH",
        successful: true,
      });

      const result = await adapter.submitTransaction({
        paymentId: "p",
        signedPayload: await signedPayload(),
      });

      expect(server.submitTransaction).toHaveBeenCalled();
      expect(result.transactionHash).toBe("TXHASH");
      expect(result.status).toBe(PaymentStatus.CONFIRMED);
    });

    it("maps an unsuccessful submission to FAILED", async () => {
      server.submitTransaction.mockResolvedValue({
        hash: "TXHASH",
        successful: false,
      });

      const result = await adapter.submitTransaction({
        paymentId: "p",
        signedPayload: await signedPayload(),
      });

      expect(result.status).toBe(PaymentStatus.FAILED);
    });
  });

  describe("getStatus", () => {
    it("reads the transaction by hash", async () => {
      server.transactions.mockReturnValue(
        callChain({ hash: "TXHASH", successful: true }),
      );

      const status = await adapter.getStatus("TXHASH");

      expect(status.status).toBe(PaymentStatus.CONFIRMED);
      expect(status.transactionHash).toBe("TXHASH");
    });
  });

  describe("refund", () => {
    beforeEach(() => {
      server.payments.mockReturnValue(
        callChain({
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
      );
      server.loadAccount.mockResolvedValue(
        new Account(signingKp.publicKey(), "200"),
      );
      server.submitTransaction.mockResolvedValue({
        hash: "REFUNDHASH",
        successful: true,
      });
    });

    it("reverses the full payment back to the payer", async () => {
      const result = await adapter.refund({
        paymentId: "TXHASH",
        idempotencyKey: "r-1",
      });

      expect(result.status).toBe(PaymentStatus.REFUNDED);
      expect(result.refundedAmount).toBe("10");
      expect(result.refundId).toBe("REFUNDHASH");
    });

    it("marks a smaller refund as PARTIALLY_REFUNDED", async () => {
      const result = await adapter.refund({
        paymentId: "TXHASH",
        amount: "4",
        idempotencyKey: "r-2",
      });

      expect(result.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(result.refundedAmount).toBe("4");
    });

    it("throws when no signing secret is configured", async () => {
      const noSecret = new StellarAdapter(
        server as any,
        {
          get: jest.fn((_key: string, def?: unknown) => def),
        } as unknown as ConfigService,
      );

      await expect(
        noSecret.refund({ paymentId: "TXHASH", idempotencyKey: "r-3" }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });
  });
});
