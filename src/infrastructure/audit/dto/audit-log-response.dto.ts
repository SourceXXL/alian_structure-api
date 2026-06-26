import { ApiProperty } from "@nestjs/swagger";
import { AuditLogAction } from "../entities/audit-log.entity";

export class AuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  userId: string | null;

  @ApiProperty({ enum: AuditLogAction })
  action: AuditLogAction;

  @ApiProperty({ nullable: true })
  resourceType: string | null;

  @ApiProperty({ nullable: true })
  resourceId: string | null;

  @ApiProperty()
  ipAddress: string;

  @ApiProperty({ nullable: true })
  userAgent: string | null;

  @ApiProperty({ nullable: true })
  details: string | null;

  @ApiProperty({ nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  archivedAt: Date | null;
}

export class AuditLogListResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  data: AuditLogResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}