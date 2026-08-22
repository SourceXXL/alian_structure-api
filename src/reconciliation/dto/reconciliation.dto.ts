import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from "class-validator";

export class CreateReconciliationInvoiceDto {
  @ApiProperty({ example: "INV-2026-0001" })
  @IsString()
  @MaxLength(255)
  invoiceId: string;

  @ApiProperty({ example: "125.5000000" })
  @IsNumberString()
  expectedAmount: string;

  @ApiProperty({ example: "GABC...DEST" })
  @IsString()
  @Length(56, 56)
  destinationAccount: string;

  @ApiPropertyOptional({ example: "order-0001" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentReference?: string;

  @ApiPropertyOptional({ example: "XLM" })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  assetCode?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class IngestStellarTransactionDto {
  @ApiProperty({ example: "a transaction hash" })
  @IsString()
  @MaxLength(128)
  transactionId: string;

  @ApiPropertyOptional({ example: "123456" })
  @IsOptional()
  @IsString()
  ledger?: string;

  @ApiPropertyOptional({ example: "GABC...SOURCE" })
  @IsOptional()
  @IsString()
  @Length(56, 56)
  sourceAccount?: string;

  @ApiProperty({ example: "GABC...DEST" })
  @IsString()
  @Length(56, 56)
  destinationAccount: string;

  @ApiProperty({ example: "125.5000000" })
  @IsNumberString()
  amount: string;

  @ApiPropertyOptional({ example: "XLM" })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  assetCode?: string;

  @ApiPropertyOptional({ example: "order-0001" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  memo?: string;

  @ApiPropertyOptional({ example: "2026-08-21T12:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  observedAt?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}

export class ManualReconciliationDto {
  @ApiPropertyOptional({ example: "manual-review-123" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
