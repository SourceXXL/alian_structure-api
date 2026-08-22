import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { STELLAR_PROCESSOR_NAME } from "./adapters/stellar/stellar.constants";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { StellarSubmitDto } from "./dto/stellar-submit.dto";
import {
  CreatedPayment,
  PaymentStatus,
  PaymentStatusResult,
  SubmittedTransaction,
} from "./interfaces/payment-processor.interface";
import { PaymentsService } from "./payments.service";

/**
 * Stellar-specific convenience API matching the endpoints named in the feature
 * spec: `POST /payments/stellar/create`, `POST /payments/stellar/submit`,
 * `GET /payments/stellar/status`. Every route pins the processor to Stellar, so
 * no `X-Payment-Processor` header is needed and `PAYMENTS_DEFAULT_PROCESSOR` is
 * ignored here.
 *
 * The routes are thin aliases over {@link PaymentsService}:
 *  - `create` → the generic create, forced to Stellar.
 *  - `submit` → folds server-side sign + submit into one call (Stellar signs
 *    server-side, so the spec's create → submit flow needs no sign step); a
 *    pre-signed `signedPayload` is also accepted and submitted as-is.
 *  - `status` → the generic status lookup, by on-chain transaction hash.
 *
 * ── ROUTE PRECEDENCE (important) ──────────────────────────────────────────
 * `payments/stellar/submit` and `payments/stellar/status` are static paths that
 * otherwise match the generic dynamic routes `payments/:id/submit` and
 * `payments/:id/status` (with `:id` = "stellar"). Express matches in
 * registration order, so this controller MUST be listed before
 * {@link PaymentsController} in PaymentsModule's `controllers` array. The
 * integration spec asserts this precedence so a future reorder fails loudly.
 */
@ApiTags("Payments — Stellar")
@ApiBearerAuth()
@Controller(`payments/${STELLAR_PROCESSOR_NAME}`)
@UseGuards(JwtAuthGuard)
export class StellarPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("create")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create (but do not submit) a Stellar payment" })
  createPayment(@Body() dto: CreatePaymentDto): Promise<CreatedPayment> {
    return this.paymentsService.createPayment(dto, STELLAR_PROCESSOR_NAME);
  }

  @Post("submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Submit a Stellar payment — signs server-side when given the unsigned XDR, or submits a client-signed payload",
  })
  submit(@Body() dto: StellarSubmitDto): Promise<SubmittedTransaction> {
    if (dto.signedPayload) {
      return this.paymentsService.submitTransaction(
        { paymentId: dto.paymentId, signedPayload: dto.signedPayload },
        STELLAR_PROCESSOR_NAME,
      );
    }
    if (dto.unsignedTransaction) {
      return this.paymentsService.signAndSubmit(
        {
          paymentId: dto.paymentId,
          status: PaymentStatus.PENDING,
          unsignedTransaction: dto.unsignedTransaction,
        },
        STELLAR_PROCESSOR_NAME,
      );
    }
    throw new BadRequestException(
      "Provide either 'signedPayload' (client-signed) or 'unsignedTransaction' (to sign server-side).",
    );
  }

  @Get("status")
  @ApiOperation({ summary: "Get a Stellar payment's status by transaction hash" })
  @ApiQuery({
    name: "id",
    description: "On-chain transaction hash returned by submit",
  })
  getStatus(@Query("id") id?: string): Promise<PaymentStatusResult> {
    if (!id) {
      throw new BadRequestException(
        "Query parameter 'id' (transaction hash) is required.",
      );
    }
    return this.paymentsService.getStatus(id, STELLAR_PROCESSOR_NAME);
  }
}
