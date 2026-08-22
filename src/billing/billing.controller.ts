import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { BillingService } from "./billing.service";
import { RecordUsageDto } from "./dto/record-usage.dto";
import { SetPlanDto } from "./dto/set-plan.dto";

@ApiTags("Billing")
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("plans")
  getPlans() {
    return this.billingService.getPlans();
  }

  @Get("accounts/:accountId/plan")
  getPlan(@Param("accountId") accountId: string) {
    return this.billingService.getPlan(accountId);
  }

  @Post("accounts/:accountId/plan")
  setPlan(@Param("accountId") accountId: string, @Body() body: SetPlanDto) {
    return this.billingService.setPlan(accountId, body.planId);
  }

  @Post("accounts/:accountId/usage")
  recordUsage(
    @Param("accountId") accountId: string,
    @Body() body: RecordUsageDto,
  ) {
    return this.billingService.recordUsage(accountId, body);
  }

  @Get("accounts/:accountId/usage")
  getUsage(@Param("accountId") accountId: string) {
    return this.billingService.getUsage(accountId);
  }

  @Get("accounts/:accountId/export")
  exportUsage(
    @Param("accountId") accountId: string,
    @Query("format") format: "csv" | "stripe" = "csv",
    @Res() response: Response,
  ) {
    const payload = this.billingService.exportUsage(
      accountId,
      format === "stripe" ? "stripe" : "csv",
    );
    if (typeof payload === "string")
      return response.type("text/csv").send(payload);
    return response.json(payload);
  }

  @Post("accounts/:accountId/invoice-preview")
  invoicePreview(@Param("accountId") accountId: string) {
    return this.billingService.createInvoicePreview(accountId);
  }
}
