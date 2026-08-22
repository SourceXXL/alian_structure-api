import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { RateLimitStrategy } from "../interfaces";

export class SetRateLimitDto {
  @IsString()
  key: string;

  @IsEnum(RateLimitStrategy)
  strategy: RateLimitStrategy;

  @IsInt()
  @Min(1)
  limit: number;

  @IsInt()
  @Min(1)
  windowMs: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  burst?: number;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  tier?: string;
}

export class RateLimitResetDto {
  @IsString()
  key: string;

  @IsOptional()
  @IsString()
  scope?: string;
}

export class RateLimitStatusDto {
  @IsOptional()
  @IsString()
  tracker?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  tier?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;
}
