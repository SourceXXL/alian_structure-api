import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { ListEntryType, RateLimitStrategy } from "../interfaces";

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

export class AddWhitelistDto {
  @IsString()
  type: ListEntryType; // "ip" | "user" | "key" | "path"

  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expiresAt?: number;
}

export class AddBlacklistDto {
  @IsString()
  type: "ip" | "user" | "key";

  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expiresAt?: number;
}

export class ViolationQueryDto {
  @IsOptional()
  @IsString()
  tracker?: string;

  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 100;

  @IsOptional()
  @IsInt()
  since?: number;
}

export class AddEndpointRuleDto {
  @IsString()
  pathPattern: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  windowMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  burst?: number;

  @IsOptional()
  @IsEnum(RateLimitStrategy)
  strategy?: RateLimitStrategy;
}
