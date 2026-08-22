import {
  Allow,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";
import {
  CreatedPayment,
  PaymentRequest,
  PaymentStatus,
} from "../interfaces/payment-processor.interface";

/** Decimal-string amount, e.g. "10" or "10.5". No leading sign, no exponent. */
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

/**
 * Body for `POST /payments` — create (but do not submit) a payment.
 * Implements {@link PaymentRequest} so the controller can hand it straight to
 * the resolved processor.
 */
export class CreatePaymentDto implements PaymentRequest {
  @IsString()
  @Matches(DECIMAL_STRING, {
    message: "amount must be a non-negative decimal string, e.g. '10.5'",
  })
  amount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  destination: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Body for `POST /payments/:id/sign` — the created payment returned by
 * `createPayment`, minus `paymentId` (which comes from the URL). The controller
 * reconstructs a {@link CreatedPayment} from this + the route param.
 */
export class SignTransactionDto implements Omit<CreatedPayment, "paymentId"> {
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  /** Free-form unsigned payload (e.g. Stellar XDR). */
  @Allow()
  unsignedTransaction?: unknown;

  /** Free-form raw backend response. */
  @Allow()
  raw?: unknown;
}
