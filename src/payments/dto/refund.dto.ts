import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";
import { RefundRequest } from "../interfaces/payment-processor.interface";

/** Decimal-string amount, e.g. "10" or "10.5". */
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

/**
 * Body for `POST /payments/:id/refund` — the refund request, minus `paymentId`
 * (which comes from the URL). Omit `amount` for a full refund.
 */
export class RefundDto implements Omit<RefundRequest, "paymentId"> {
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_STRING, {
    message: "amount must be a non-negative decimal string, e.g. '10.5'",
  })
  amount?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
