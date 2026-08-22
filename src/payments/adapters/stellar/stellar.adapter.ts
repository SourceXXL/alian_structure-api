import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PreconditionFailedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { v4 as uuidv4 } from "uuid";
import { RegisterPaymentProcessor } from "../../decorators/register-payment-processor.decorator";
import {
  CreatedPayment,
  IPaymentProcessor,
  PaymentCapabilities,
  PaymentRequest,
  PaymentStatus,
  PaymentStatusResult,
  RefundRequest,
  RefundResult,
  SignedTransaction,
  SubmittedTransaction,
} from "../../interfaces/payment-processor.interface";
import { STELLAR_HORIZON_SERVER, STELLAR_PROCESSOR_NAME } from "./stellar.constants";

/** Config accepted by {@link StellarAdapter.initialize}. */
export interface StellarConfig {
  networkPassphrase: string;
  /** Secret seed the server signs with (server-side signing). */
  signingSecret?: string;
}

/**
 * Real Stellar payment processor built on the official `@stellar/stellar-sdk`
 * (Horizon, testnet by default). Payments are ordinary Stellar `payment`
 * operations; the create → sign → submit flow maps to build-XDR → sign-XDR →
 * Horizon submit.
 *
 * Signing is server-side (`requiresClientSideSigning: false`): the server holds
 * `STELLAR_SIGNING_SECRET` and signs the unsigned XDR produced by `createPayment`.
 *
 * NOTE ON IDS: `createPayment` returns a local correlation UUID (`paymentId`) —
 * there is no on-chain hash until submission. After `submitTransaction` the
 * on-chain `transactionHash` is available; that hash is what `getStatus` and
 * `refund` expect as their id (Stellar can only look records up by hash).
 */
@Injectable()
@RegisterPaymentProcessor()
export class StellarAdapter implements IPaymentProcessor<
  StellarConfig,
  PaymentRequest,
  CreatedPayment
> {
  readonly name = STELLAR_PROCESSOR_NAME;
  readonly displayName = "Stellar";
  readonly capabilities: PaymentCapabilities = {
    // Stellar has no native refund; we reverse the payment, and can send back a
    // partial amount, so partial refunds are supported.
    supportsPartialRefund: true,
    requiresClientSideSigning: false,
    currencies: ["XLM"],
  };

  private readonly logger = new Logger(StellarAdapter.name);
  private networkPassphrase: string;
  private signingSecret?: string;

  constructor(
    @Inject(STELLAR_HORIZON_SERVER)
    private readonly server: Horizon.Server,
    private readonly configService: ConfigService,
  ) {
    this.networkPassphrase = this.configService.get<string>(
      "STELLAR_NETWORK_PASSPHRASE",
      Networks.TESTNET,
    );
    this.signingSecret = this.configService.get<string>(
      "STELLAR_SIGNING_SECRET",
    );
  }

  async initialize(config?: Partial<StellarConfig>): Promise<void> {
    if (config?.networkPassphrase) {
      this.networkPassphrase = config.networkPassphrase;
    }
    if (config?.signingSecret !== undefined) {
      this.signingSecret = config.signingSecret;
    }
  }

  async createPayment(request: PaymentRequest): Promise<CreatedPayment> {
    const source = request.source ?? this.serverPublicKey();
    if (!source) {
      throw new BadRequestException(
        "Stellar payment requires a 'source' (or a configured STELLAR_SIGNING_SECRET).",
      );
    }

    const asset = this.resolveAsset(request);
    let sourceAccount: Horizon.AccountResponse;
    try {
      sourceAccount = await this.server.loadAccount(source);
    } catch (err) {
      throw this.toStellarError(err, `Failed to load source account ${source}`);
    }

    const builder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    }).addOperation(
      Operation.payment({
        destination: request.destination,
        asset,
        amount: request.amount,
      }),
    );

    if (request.reference) {
      // Stellar text memos are capped at 28 bytes.
      builder.addMemo(Memo.text(request.reference.slice(0, 28)));
    }

    const transaction = builder.setTimeout(180).build();

    return {
      paymentId: uuidv4(),
      status: PaymentStatus.PENDING,
      unsignedTransaction: transaction.toXdr(),
      raw: { source, networkPassphrase: this.networkPassphrase },
    };
  }

  async signTransaction(created: CreatedPayment): Promise<SignedTransaction> {
    if (!this.signingSecret) {
      throw new PreconditionFailedException(
        "STELLAR_SIGNING_SECRET is not configured; cannot sign server-side.",
      );
    }
    if (typeof created.unsignedTransaction !== "string") {
      throw new BadRequestException(
        "Missing unsigned transaction XDR to sign.",
      );
    }

    const keypair = Keypair.fromSecret(this.signingSecret);
    const transaction = TransactionBuilder.fromXdr(
      created.unsignedTransaction,
      this.networkPassphrase,
    );
    transaction.sign(keypair);

    return {
      paymentId: created.paymentId,
      signedPayload: transaction.toXdr(),
      signerAddress: keypair.publicKey(),
    };
  }

  async submitTransaction(
    signed: SignedTransaction,
  ): Promise<SubmittedTransaction> {
    const transaction = TransactionBuilder.fromXdr(
      signed.signedPayload,
      this.networkPassphrase,
    );

    try {
      const response = await this.server.submitTransaction(transaction as any);
      return {
        paymentId: signed.paymentId,
        transactionHash: response.hash,
        status: response.successful
          ? PaymentStatus.CONFIRMED
          : PaymentStatus.FAILED,
        raw: response,
      };
    } catch (err) {
      throw this.toStellarError(err, "Failed to submit transaction to Horizon");
    }
  }

  /** @param paymentId the on-chain transaction hash returned by submit. */
  async getStatus(paymentId: string): Promise<PaymentStatusResult> {
    try {
      const record: any = await this.server
        .transactions()
        .transaction(paymentId)
        .call();
      return {
        paymentId,
        status: record.successful
          ? PaymentStatus.CONFIRMED
          : PaymentStatus.FAILED,
        transactionHash: record.hash,
        raw: record,
      };
    } catch (err) {
      throw this.toStellarError(
        err,
        `Failed to fetch transaction ${paymentId}`,
      );
    }
  }

  /**
   * Stellar has no native refund, so we reverse the original payment: look the
   * original payment operation up by transaction hash (`request.paymentId`),
   * then send funds back from the original recipient to the original payer.
   *
   * This assumes the configured signing key controls the account that received
   * the funds (the original `to`). Partial refunds send back `request.amount`.
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    if (!this.signingSecret) {
      throw new PreconditionFailedException(
        "STELLAR_SIGNING_SECRET is not configured; cannot issue a refund.",
      );
    }

    let original: any;
    try {
      const page: any = await this.server
        .payments()
        .forTransaction(request.paymentId)
        .call();
      original = (page.records ?? []).find(
        (r: any) => r.type === "payment" || r.amount !== undefined,
      );
    } catch (err) {
      throw this.toStellarError(
        err,
        `Failed to load original payment ${request.paymentId}`,
      );
    }

    if (!original) {
      throw new BadRequestException(
        `No payment operation found for transaction ${request.paymentId}.`,
      );
    }

    const fullAmount = String(original.amount);
    const refundAmount = request.amount ?? fullAmount;
    const asset =
      original.asset_type === "native"
        ? Asset.native()
        : new Asset(original.asset_code, original.asset_issuer);

    const keypair = Keypair.fromSecret(this.signingSecret);
    let recipientAccount: Horizon.AccountResponse;
    try {
      // The original recipient (`to`) sends the funds back to the payer (`from`).
      recipientAccount = await this.server.loadAccount(original.to);
    } catch (err) {
      throw this.toStellarError(err, "Failed to load refund source account");
    }

    const reversal = new TransactionBuilder(recipientAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: original.from,
          asset,
          amount: refundAmount,
        }),
      )
      .addMemo(Memo.text((request.reason ?? "refund").slice(0, 28)))
      .setTimeout(180)
      .build();
    reversal.sign(keypair);

    let response: any;
    try {
      response = await this.server.submitTransaction(reversal as any);
    } catch (err) {
      throw this.toStellarError(err, "Failed to submit refund transaction");
    }

    const isPartial = Number(refundAmount) < Number(fullAmount);
    return {
      refundId: response.hash,
      paymentId: request.paymentId,
      status: isPartial
        ? PaymentStatus.PARTIALLY_REFUNDED
        : PaymentStatus.REFUNDED,
      refundedAmount: refundAmount,
      raw: response,
    };
  }

  /** Public key of the configured signing secret, if any. */
  private serverPublicKey(): string | undefined {
    if (!this.signingSecret) {
      return undefined;
    }
    try {
      return Keypair.fromSecret(this.signingSecret).publicKey();
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve the Stellar {@link Asset} for a request. "XLM"/"native" → native
   * lumens; anything else requires an issuer in `metadata.assetIssuer` and uses
   * `currency` as the asset code.
   */
  private resolveAsset(request: PaymentRequest): Asset {
    const currency = request.currency?.toUpperCase();
    if (!currency || currency === "XLM" || currency === "NATIVE") {
      return Asset.native();
    }
    const issuer = request.metadata?.assetIssuer as string | undefined;
    if (!issuer) {
      throw new BadRequestException(
        `Non-native asset "${request.currency}" requires metadata.assetIssuer.`,
      );
    }
    return new Asset(request.currency, issuer);
  }

  /** Normalise Horizon/SDK errors into a Nest exception with result codes. */
  private toStellarError(err: any, context: string): Error {
    const resultCodes = err?.response?.data?.extras?.result_codes;
    const detail = resultCodes
      ? `${context}: ${JSON.stringify(resultCodes)}`
      : `${context}: ${err?.message ?? "unknown Horizon error"}`;
    this.logger.error(detail);
    return new ServiceUnavailableException(detail);
  }
}
