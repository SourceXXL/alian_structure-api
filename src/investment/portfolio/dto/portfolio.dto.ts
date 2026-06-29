import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsJSON,
  IsObject,
  Min,
  Max,
} from "class-validator";
import { PortfolioType, PortfolioStatus, AllocationStrategy } from "../entities/portfolio.entity";
export class CreatePortfolioDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(PortfolioType)
  type?: PortfolioType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  initialAllocation?: Record<string, number>;

  @IsOptional()
  @IsObject()
  targetAllocation?: Record<string, number>;

  @IsOptional()
  @IsEnum(AllocationStrategy)
  allocationStrategy?: AllocationStrategy;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalValue?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  autoRebalanceEnabled?: boolean;

  @IsOptional()
  @IsString()
  rebalanceFrequency?: "daily" | "weekly" | "monthly" | "quarterly";

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rebalanceThreshold?: number;
}

export class UpdatePortfolioDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(PortfolioType)
  type?: PortfolioType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PortfolioStatus)
  status?: PortfolioStatus;

  @IsOptional()
  @IsObject()
  initialAllocation?: Record<string, number>;

  @IsOptional()
  @IsObject()
  currentAllocation?: Record<string, number>;

  @IsOptional()
  @IsObject()
  targetAllocation?: Record<string, number>;

  @IsOptional()
  @IsEnum(AllocationStrategy)
  allocationStrategy?: AllocationStrategy;

  @IsOptional()
  @IsBoolean()
  autoRebalanceEnabled?: boolean;

  @IsOptional()
  @IsString()
  rebalanceFrequency?: "daily" | "weekly" | "monthly" | "quarterly";

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rebalanceThreshold?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class PortfolioResponseDto {
  id: string;
  name: string;
  type: PortfolioType;
  description?: string;
  status: PortfolioStatus;
  initialAllocation: Record<string, number>;
  currentAllocation: Record<string, number>;
  targetAllocation?: Record<string, number>;
  allocationStrategy?: AllocationStrategy;
  totalValue: number;
  autoRebalanceEnabled: boolean;
  rebalanceFrequency?: string;
  rebalanceThreshold: number;
  lastRebalanceDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}
