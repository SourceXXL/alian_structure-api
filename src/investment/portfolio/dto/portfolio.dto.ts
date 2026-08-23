import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsJSON,
} from "class-validator";
import { PortfolioStatus } from "../entities/portfolio.entity";
export class CreatePortfolioDto {
  @ApiProperty({ example: "Retirement Growth" })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: "Diversified long-term portfolio" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  @IsNumber()
  totalValue?: number;

  @ApiPropertyOptional({ example: { strategy: "balanced" } })
  @IsOptional()
  @IsJSON()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  autoRebalanceEnabled?: boolean;

  @ApiPropertyOptional({
    example: "monthly",
    enum: ["daily", "weekly", "monthly", "quarterly"],
  })
  @IsOptional()
  @IsString()
  rebalanceFrequency?: "daily" | "weekly" | "monthly" | "quarterly";

  @ApiPropertyOptional({ example: 5, minimum: 0 })
  @IsOptional()
  @IsNumber()
  rebalanceThreshold?: number;

  @ApiPropertyOptional({ example: { BTC: 50, ETH: 50 } })
  @IsOptional()
  @IsJSON()
  initialAllocation?: Record<string, number>;
}

export class UpdatePortfolioDto {
  @ApiPropertyOptional({ example: "Retirement Growth" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: "Diversified long-term portfolio" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: "active",
    enum: ["active", "inactive", "archived"],
  })
  @IsOptional()
  @IsEnum(PortfolioStatus)
  status?: PortfolioStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  autoRebalanceEnabled?: boolean;

  @ApiPropertyOptional({
    example: "monthly",
    enum: ["daily", "weekly", "monthly", "quarterly"],
  })
  @IsOptional()
  @IsString()
  rebalanceFrequency?: "daily" | "weekly" | "monthly" | "quarterly";

  @ApiPropertyOptional({ example: 5, minimum: 0 })
  @IsOptional()
  @IsNumber()
  rebalanceThreshold?: number;

  @ApiPropertyOptional({ example: { strategy: "balanced" } })
  @IsOptional()
  @IsJSON()
  metadata?: Record<string, any>;
}

export class PortfolioResponseDto {
  @ApiProperty({ example: "d9e6c8d0-5f9c-4bb1-8db2-7d3b0d0a1d1f" })
  id: string;

  @ApiProperty({ example: "Retirement Growth" })
  name: string;

  @ApiPropertyOptional({ example: "Diversified long-term portfolio" })
  description?: string;

  @ApiProperty({ example: "active", enum: ["active", "inactive", "archived"] })
  status: PortfolioStatus;

  @ApiProperty({ example: 10000 })
  totalValue: number;

  @ApiProperty({ example: { AAPL: 50, MSFT: 50 } })
  currentAllocation: Record<string, number>;

  @ApiPropertyOptional({ example: { AAPL: 60, MSFT: 40 } })
  targetAllocation?: Record<string, number>;

  @ApiProperty({ example: true })
  autoRebalanceEnabled: boolean;

  @ApiPropertyOptional({ example: "monthly" })
  rebalanceFrequency?: string;

  @ApiProperty({ example: 5 })
  rebalanceThreshold: number;

  @ApiPropertyOptional({ example: "2026-06-20T00:00:00.000Z" })
  lastRebalanceDate?: Date;

  @ApiProperty({ example: "2026-06-20T00:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2026-06-20T00:00:00.000Z" })
  updatedAt: Date;
}

export class PortfolioListResponseDto {
  @ApiProperty({ type: [PortfolioResponseDto] })
  portfolios: PortfolioResponseDto[];
}
