import { IsInt, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class RecordUsageDto {
  @IsString()
  metric: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  tokenizedAccessId?: string;

  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
