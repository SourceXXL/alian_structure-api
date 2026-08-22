import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { Roles } from "src/common/guard/roles.decorator";
import { RolesGuard } from "src/common/guard/roles.guard";
import { Role } from "src/common/guard/roles.enum";
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto, SignTransactionDto } from "./dto/create-payment.dto";
import { SubmitTransactionDto } from "./dto/submit-transaction.dto";
import { RefundDto } from "./dto/refund.dto";
import {
  CreatedPayment,
  PaymentProcessorInfo,
  PaymentStatusResult,
  RefundResult,
  SignedTransaction,
  SubmittedTransaction,
} from "./interfaces/payment-processor.interface";

/** Header that selects the processor for a request (overrides env default). */
const PROCESSOR_HEADER = "x-payment-processor";

/**
 * Payments API — a single set of endpoints in front of every registered
 * payment processor. Which processor handles a call is chosen per request via
 * the `X-Payment-Processor` header (or `?processor=`), falling back to the
 * `PAYMENTS_DEFAULT_PROCESSOR` env default, then to the sole enabled processor.
 *
 * Guarded by JWT (+ the global KYC guard). Enable/disable are admin-only.
 * The create → sign → submit flow is stateless: each step's output is posted
 * back in as the next step's body.
 */
@ApiTags("Payments")
@ApiBearerAuth()
@Controller("payments")
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create (but do not submit) a payment" })
  createPayment(
    @Body() dto: CreatePaymentDto,
    @Headers(PROCESSOR_HEADER) headerProcessor?: string,
    @Query("processor") queryProcessor?: string,
  ): Promise<CreatedPayment> {
    return this.paymentsService.createPayment(
      dto,
      queryProcessor ?? headerProcessor,
    );
  }

  @Post(":id/sign")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign a created payment" })
  @ApiParam({ name: "id", description: "Payment id from createPayment" })
  signTransaction(
    @Param("id") id: string,
    @Body() dto: SignTransactionDto,
    @Headers(PROCESSOR_HEADER) headerProcessor?: string,
    @Query("processor") queryProcessor?: string,
  ): Promise<SignedTransaction> {
    return this.paymentsService.signTransaction(
      { paymentId: id, ...dto },
      queryProcessor ?? headerProcessor,
    );
  }

  @Post(":id/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit a signed transaction" })
  @ApiParam({ name: "id", description: "Payment id from createPayment" })
  submitTransaction(
    @Param("id") id: string,
    @Body() dto: SubmitTransactionDto,
    @Headers(PROCESSOR_HEADER) headerProcessor?: string,
    @Query("processor") queryProcessor?: string,
  ): Promise<SubmittedTransaction> {
    return this.paymentsService.submitTransaction(
      { paymentId: id, ...dto },
      queryProcessor ?? headerProcessor,
    );
  }

  @Get(":id/status")
  @ApiOperation({ summary: "Get the status of a payment/transaction" })
  @ApiParam({ name: "id", description: "Payment id or transaction hash" })
  getStatus(
    @Param("id") id: string,
    @Headers(PROCESSOR_HEADER) headerProcessor?: string,
    @Query("processor") queryProcessor?: string,
  ): Promise<PaymentStatusResult> {
    return this.paymentsService.getStatus(
      id,
      queryProcessor ?? headerProcessor,
    );
  }

  @Post(":id/refund")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refund a payment (full or partial)" })
  @ApiParam({ name: "id", description: "Payment id or transaction hash" })
  refund(
    @Param("id") id: string,
    @Body() dto: RefundDto,
    @Headers(PROCESSOR_HEADER) headerProcessor?: string,
    @Query("processor") queryProcessor?: string,
  ): Promise<RefundResult> {
    return this.paymentsService.refund(
      { paymentId: id, ...dto },
      queryProcessor ?? headerProcessor,
    );
  }

  @Get("processors")
  @ApiOperation({ summary: "List registered processors and their state" })
  listProcessors(): PaymentProcessorInfo[] {
    return this.paymentsService.listProcessors();
  }

  @Post("processors/:name/enable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Enable a processor (admin only)" })
  @ApiParam({ name: "name", description: "Processor name, e.g. 'stellar'" })
  enableProcessor(@Param("name") name: string): PaymentProcessorInfo[] {
    return this.paymentsService.enableProcessor(name);
  }

  @Post("processors/:name/disable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Disable a processor (admin only)" })
  @ApiParam({ name: "name", description: "Processor name, e.g. 'stellar'" })
  disableProcessor(@Param("name") name: string): PaymentProcessorInfo[] {
    return this.paymentsService.disableProcessor(name);
  }
}
