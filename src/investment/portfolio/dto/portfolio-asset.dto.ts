import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Length,
  IsBoolean,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Chain, AssetType } from "../entities/portfolio-asset.entity";

export class PortfolioAssetDto {
  @ApiProperty({ description: "Ticker symbol of the asset", example: "BTC" })
  @IsString()
  @Length(3, 10)
  ticker: string;

  @ApiProperty({ description: "Name of the asset", example: "Bitcoin" })
  @IsString()
  name: string;

  @ApiProperty({ description: "Blockchain network of the asset", enum: Chain })
  @IsEnum(Chain)
  chain: Chain;

  @ApiPropertyOptional({ description: "Type of the asset", enum: AssetType })
  @IsOptional()
  @IsEnum(AssetType)
  type?: AssetType;

  @ApiPropertyOptional({
    description: "Quantity of the asset held",
    example: 1.5,
  })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({
    description: "Current price of the asset",
    example: 60000,
  })
  @IsOptional()
  @IsNumber()
  currentPrice?: number;

  @ApiPropertyOptional({
    description: "Cost basis of the asset",
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  costBasis?: number;
}

export class AddAssetToPortfolioDto {
  @ApiProperty({ description: "Ticker symbol of the asset", example: "BTC" })
  @IsString()
  ticker: string;

  @ApiProperty({ description: "Name of the asset", example: "Bitcoin" })
  @IsString()
  name: string;

  @ApiProperty({ description: "Quantity of the asset to add", example: 1.5 })
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({
    description: "Current price of the asset",
    example: 60000,
  })
  @IsOptional()
  @IsNumber()
  currentPrice?: number;

  @ApiPropertyOptional({
    description: "Cost basis of the asset",
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  costBasis?: number;
}

export class ConstraintOverrideDto {
  @ApiPropertyOptional({
    description: "Override constraints for this operation",
  })
  @IsOptional()
  @IsBoolean()
  overrideConstraints?: boolean;

  @ApiPropertyOptional({ description: "Reason for overriding constraints" })
  @IsOptional()
  @IsString()
  overrideReason?: string;

  @ApiPropertyOptional({ description: "User who acknowledged the override" })
  @IsOptional()
  @IsString()
  acknowledgedBy?: string;
}

export class AddHoldingDto extends ConstraintOverrideDto {
  @ApiProperty({ description: "Ticker symbol of the asset", example: "BTC" })
  @IsString()
  @Length(3, 10)
  ticker: string;

  @ApiProperty({ description: "Name of the asset", example: "Bitcoin" })
  @IsString()
  name: string;

  @ApiProperty({ description: "Blockchain network of the asset", enum: Chain })
  @IsEnum(Chain)
  chain: Chain;

  @ApiPropertyOptional({ description: "Type of the asset", enum: AssetType })
  @IsOptional()
  @IsEnum(AssetType)
  type?: AssetType;

  @ApiProperty({ description: "Quantity of the asset to add", example: 1.5 })
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({
    description: "Current price of the asset",
    example: 60000,
  })
  @IsOptional()
  @IsNumber()
  currentPrice?: number;

  @ApiProperty({ description: "Cost basis of the asset", example: 50000 })
  @IsNumber()
  costBasis: number;
}

export class UpdateHoldingDto extends ConstraintOverrideDto {
  @ApiPropertyOptional({ description: "New quantity of the asset" })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ description: "New current price of the asset" })
  @IsOptional()
  @IsNumber()
  currentPrice?: number;

  @ApiPropertyOptional({ description: "New cost basis of the asset" })
  @IsOptional()
  @IsNumber()
  costBasis?: number;
}

export class PortfolioAssetResponseDto {
  @ApiProperty({ description: "Unique identifier of the portfolio asset" })
  id: string;
  @ApiProperty({ description: "Ticker symbol of the asset" })
  ticker: string;
  @ApiProperty({ description: "Name of the asset" })
  name: string;
  @ApiProperty({ description: "Blockchain network of the asset", enum: Chain })
  chain: Chain;
  @ApiProperty({ description: "Type of the asset", enum: AssetType })
  type: AssetType;
  @ApiProperty({ description: "Quantity of the asset held" })
  quantity: number;
  @ApiPropertyOptional({ description: "Current price of the asset" })
  currentPrice?: number;
  @ApiProperty({ description: "Total value of the asset holding" })
  value: number;
  @ApiProperty({
    description: "Allocation percentage of the asset in the portfolio",
  })
  allocationPercentage: number;
  @ApiPropertyOptional({
    description: "Suggested allocation percentage for the asset",
  })
  suggestedAllocation?: number;
  @ApiPropertyOptional({ description: "Expected return of the asset" })
  expectedReturn?: number;
  @ApiPropertyOptional({ description: "Volatility of the asset" })
  volatility?: number;
  @ApiPropertyOptional({ description: "Beta of the asset" })
  beta?: number;
  @ApiPropertyOptional({ description: "Cost basis of the asset" })
  costBasis?: number;
  @ApiPropertyOptional({ description: "Unrealized gain of the asset" })
  unrealizedGain?: number;
  @ApiProperty({ description: "Date of last update" })
  updatedAt: Date;
}
