import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { SignedTransaction } from "../interfaces/payment-processor.interface";

/**
 * Body for `POST /payments/:id/submit` — the signed transaction returned by
 * `signTransaction`, minus `paymentId` (which comes from the URL).
 */
export class SubmitTransactionDto implements Omit<
  SignedTransaction,
  "paymentId"
> {
  @IsString()
  @IsNotEmpty()
  signedPayload: string;

  @IsOptional()
  @IsString()
  signerAddress?: string;
}
