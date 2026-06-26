import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Res,
  ParseUUIDPipe,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { AuditLogService } from "./audit-log.service";
import { QueryAuditLogDto, ExportAuditLogDto } from "./dto/query-audit-log.dto";
import {
  AuditLogResponseDto,
  AuditLogListResponseDto,
} from "./dto/audit-log-response.dto";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { ComplianceOfficerGuard } from "./guards/compliance-officer.guard";

@ApiTags("Audit Logs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ComplianceOfficerGuard)
@Controller("audit-logs")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({
    summary: "Search and filter audit logs",
    description:
      "Full-text search with filters by user, action, IP, and date range. Paginated, 100 records per page max.",
  })
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async query(@Query() query: QueryAuditLogDto): Promise<AuditLogListResponseDto> {
    return this.auditLogService.query(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get audit log by ID" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 200, type: AuditLogResponseDto })
  @ApiResponse({ status: 404, description: "Audit log not found" })
  async getById(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AuditLogResponseDto> {
    return this.auditLogService.findById(id);
  }

  @Get("export")
  @ApiOperation({
    summary: "Bulk export audit logs",
    description:
      "Exports up to 100,000 records for a date range as signed JSON or CSV.",
  })
  @ApiResponse({ status: 200, description: "Export with integrity signature" })
  async export(
    @Query() query: ExportAuditLogDto,
    @Res() res: Response,
  ): Promise<void> {
    const { payload, signature } =
      query.format === "csv"
        ? await this.auditLogService.exportToCsv(query)
        : await this.auditLogService.exportToJson(query);

    const ext = query.format === "csv" ? "csv" : "json";
    res.setHeader(
      "Content-Type",
      query.format === "csv" ? "text/csv" : "application/json",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-logs-${Date.now()}.${ext}"`,
    );
    res.setHeader("X-Signature", signature);
    res.send(payload);
  }
}