import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../core/auth/guards/jwt-auth.guard";
import { AdminTwoFactorGuard } from "../core/auth/guards/admin-two-factor.guard";
import { RolesGuard } from "../common/guard/roles.guard";
import { Roles } from "../common/guard/roles.decorator";
import { Role } from "../common/guard/roles.enum";
import {
  CreateReconciliationInvoiceDto,
  IngestStellarTransactionDto,
  ManualReconciliationDto,
} from "./dto/reconciliation.dto";
import { ReconciliationService } from "./reconciliation.service";

@ApiTags("Stellar Reconciliation")
@Controller("reconcile/stellar")
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post("invoice")
  @ApiOperation({ summary: "Register an invoice for Stellar reconciliation" })
  createInvoice(@Body() dto: CreateReconciliationInvoiceDto) {
    return this.reconciliationService.createInvoice(dto);
  }

  @Post("transactions")
  @ApiOperation({
    summary: "Ingest a confirmed Stellar payment",
    description:
      "Idempotently records a payment and reconciles it against an invoice by destination, asset, and memo/reference.",
  })
  ingestTransaction(@Body() dto: IngestStellarTransactionDto) {
    return this.reconciliationService.ingestTransaction(dto);
  }

  @Get("tx/:txid")
  @ApiParam({ name: "txid", description: "Stellar transaction hash" })
  @ApiOperation({ summary: "Look up a Stellar transaction and its decisions" })
  getTransaction(@Param("txid") transactionId: string) {
    return this.reconciliationService.getTransaction(transactionId);
  }

  @Get("invoice/:invoiceId")
  @ApiParam({ name: "invoiceId", description: "Internal invoice identifier" })
  @ApiOperation({
    summary: "Look up an invoice and its reconciliation audit trail",
  })
  getInvoice(@Param("invoiceId") invoiceId: string) {
    return this.reconciliationService.getInvoice(invoiceId);
  }

  @Post("invoice/:invoiceId/reconcile")
  @ApiParam({ name: "invoiceId", description: "Internal invoice identifier" })
  @ApiOperation({ summary: "Retry reconciliation for an invoice" })
  manualReconcile(
    @Param("invoiceId") invoiceId: string,
    @Body() dto: ManualReconciliationDto
  ) {
    return this.reconciliationService.manualReconcile(invoiceId, dto);
  }

  @Get("admin/unmatched")
  @UseGuards(JwtAuthGuard, RolesGuard, AdminTwoFactorGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List unmatched Stellar transactions" })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 50 })
  listUnmatched(
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number
  ) {
    return this.reconciliationService.listUnmatched(limit);
  }

  @Get("admin/audit")
  @UseGuards(JwtAuthGuard, RolesGuard, AdminTwoFactorGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List reconciliation decisions" })
  @ApiQuery({ name: "invoiceId", required: false })
  @ApiQuery({ name: "transactionId", required: false })
  listAudits(
    @Query("invoiceId") invoiceId?: string,
    @Query("transactionId") transactionId?: string
  ) {
    return this.reconciliationService.listAudits(invoiceId, transactionId);
  }
}
