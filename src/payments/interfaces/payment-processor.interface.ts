/**
 * Payment-processor plugin contract.
 *
 * Every payment backend (Stellar, Grantfox, …) implements {@link IPaymentProcessor}.
 * The registry and factory operate against this base contract, so adding a new
 * processor is a drop-in: implement the interface, tag the class with
 * `@RegisterPaymentProcessor()`, and it auto-registers on module init.
 *
 * Amounts are always **decimal strings** (e.g. "10.5"), never floats — this
 * avoids IEEE-754 rounding on monetary values across every processor.
 */

/**
 * Canonical lifecycle status shared by all processors. Individual processors
 * map their native/provider-specific states onto these values so callers get a
 * uniform status regardless of backend.
 */
export enum PaymentStatus {
  /** Created locally, nothing sent to the network yet. */
  PENDING = "PENDING",
  /** In flight / provider is working on it. */
  PROCESSING = "PROCESSING",
  /** Signed transaction submitted, awaiting confirmation. */
  SUBMITTED = "SUBMITTED",
  /** Settled / confirmed on the network or by the provider. */
  CONFIRMED = "CONFIRMED",
  /** Terminal failure. */
  FAILED = "FAILED",
  /** Fully refunded. */
  REFUNDED = "REFUNDED",
  /** Partially refunded (remaining balance still settled). */
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
}

/** A request to create (but not yet submit) a payment. */
export interface PaymentRequest {
  /** Decimal string, e.g. "10.5". */
  amount: string;
  /** Asset/currency code, e.g. "XLM", "USD". */
  currency: string;
  /** Recipient identifier (Stellar public key, provider account id, …). */
  destination: string;
  /** Optional payer identifier; defaults to the processor's configured source. */
  source?: string;
  /** Optional human-readable memo/reference. */
  reference?: string;
  /**
   * Caller-supplied key that makes retries safe. Processors forward it to the
   * backend; true dedup requires persistence (see the DB seam in the README).
   */
  idempotencyKey: string;
  /** Free-form processor-specific extras. */
  metadata?: Record<string, unknown>;
}

/** The result of {@link IPaymentProcessor.createPayment}. */
export interface CreatedPayment {
  paymentId: string;
  status: PaymentStatus;
  /**
   * Backend-specific unsigned payload (e.g. a Stellar transaction XDR) that the
   * caller passes to `signTransaction`. Absent when the processor signs and
   * submits server-side in a single step.
   */
  unsignedTransaction?: unknown;
  /** Raw backend response, for debugging/audit. */
  raw?: unknown;
}

/** The result of {@link IPaymentProcessor.signTransaction}. */
export interface SignedTransaction {
  paymentId: string;
  /** Opaque signed payload passed on to `submitTransaction`. */
  signedPayload: string;
  /** Address/account that produced the signature, when known. */
  signerAddress?: string;
}

/** The result of {@link IPaymentProcessor.submitTransaction}. */
export interface SubmittedTransaction {
  paymentId: string;
  transactionHash: string;
  status: PaymentStatus;
  raw?: unknown;
}

/** The result of {@link IPaymentProcessor.getStatus}. */
export interface PaymentStatusResult {
  paymentId: string;
  status: PaymentStatus;
  transactionHash?: string;
  /** Decimal string of the amount confirmed settled, when known. */
  confirmedAmount?: string;
  raw?: unknown;
}

/** A request to refund a previously submitted payment. */
export interface RefundRequest {
  paymentId: string;
  /** Decimal string; omit for a full refund. */
  amount?: string;
  reason?: string;
  idempotencyKey: string;
}

/** The result of {@link IPaymentProcessor.refund}. */
export interface RefundResult {
  refundId: string;
  paymentId: string;
  status: PaymentStatus;
  /** Decimal string of the amount actually refunded. */
  refundedAmount: string;
  raw?: unknown;
}

/** Static, declarative description of what a processor can do. */
export interface PaymentCapabilities {
  /** Whether {@link RefundRequest.amount} (partial refunds) is honoured. */
  supportsPartialRefund: boolean;
  /**
   * When true, `createPayment` returns an unsigned payload the client must
   * sign; when false the processor signs server-side and `signTransaction`
   * is effectively a passthrough/no-op.
   */
  requiresClientSideSigning: boolean;
  /** Currencies/assets the processor accepts. */
  currencies: string[];
}

/**
 * The plugin contract every payment backend implements.
 *
 * Generics let each adapter narrow its config and native request/response
 * shapes while the registry/factory keep working against the base interface:
 *
 *  - `TConfig`  — the shape accepted by {@link initialize}.
 *  - `TCreate`  — the (possibly extended) create request the adapter accepts.
 *  - `TCreated` — the (possibly extended) created-payment the adapter returns.
 */
export interface IPaymentProcessor<
  TConfig = Record<string, unknown>,
  TCreate extends PaymentRequest = PaymentRequest,
  TCreated extends CreatedPayment = CreatedPayment,
> {
  /** Stable, lowercase key used for selection/registration, e.g. "stellar". */
  readonly name: string;
  /** Human-readable label for UIs. */
  readonly displayName: string;
  /** Declarative capabilities (see {@link PaymentCapabilities}). */
  readonly capabilities: PaymentCapabilities;

  /** Idempotent (re)configuration; safe to call more than once. */
  initialize(config?: Partial<TConfig>): Promise<void>;

  createPayment(request: TCreate): Promise<TCreated>;
  signTransaction(created: TCreated): Promise<SignedTransaction>;
  submitTransaction(signed: SignedTransaction): Promise<SubmittedTransaction>;
  getStatus(paymentId: string): Promise<PaymentStatusResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}

/** Lightweight, serialisable view of a processor for list endpoints. */
export interface PaymentProcessorInfo {
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: PaymentCapabilities;
}
