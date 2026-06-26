import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
  IsInt,
  IsIP,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { AuditLogAction } from "../entities/audit-log.entity";

export class QueryAuditLogDto {
  @ApiPropertyOptional({ description: "Full-text search across log fields" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by user ID" })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ enum: AuditLogAction })
  @IsOptional()
  @IsEnum(AuditLogAction)
  action?: AuditLogAction;

  @ApiPropertyOptional({ description: "Filter by IP address" })
  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @ApiPropertyOptional({ description: "Records created on/after this date" })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: "Records created on/before this date" })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 100, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 100;
}

export class ExportAuditLogDto {
  @ApiPropertyOptional({ enum: ["json", "csv"], default: "json" })
  @IsOptional()
  @IsString()
  format?: "json" | "csv" = "json";

  @ApiPropertyOptional()
  @IsDateString()
  fromDate: string;

  @ApiPropertyOptional()
  @IsDateString()
  toDate: string;

  @ApiPropertyOptional({ default: 10000, maximum: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  limit?: number = 10000;
}