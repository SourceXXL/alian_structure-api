import { IsNotEmpty, IsOptional, IsString } from "class-validator";

/**
 * Body for `POST /payments/stellar/submit`.
 *
 * The generic `POST /payments/:id/submit` takes the payment id from the URL and
 * requires an already-signed payload. The Stellar convenience route has no
 * `:id` segment, so the id travels in the body, and — because Stellar signs
 * server-side — it accepts EITHER:
 *
 *  - `signedPayload` — a client-signed transaction XDR, submitted as-is; or
 *  - `unsignedTransaction` — the XDR returned by `create`, which the server
 *    signs (using `STELLAR_SIGNING_SECRET`) and then submits in a single call.
 *
 * Exactly one of the two must be supplied; the controller returns 400 otherwise.
 */
export class StellarSubmitDto {
  /** Correlation id returned by `POST /payments/stellar/create`. */
  @IsString()
  @IsNotEmpty()
  paymentId: string;

  /** Client-signed transaction XDR. Mutually exclusive with `unsignedTransaction`. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  signedPayload?: string;

  /** Unsigned XDR from `create`; the server signs it before submitting. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unsignedTransaction?: string;
}
