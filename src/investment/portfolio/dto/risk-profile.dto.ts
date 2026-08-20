import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RiskTolerance, InvestmentGoal } from "../entities/risk-profile.entity";

export class CreateRiskProfileDto {
  @ApiProperty({
    description: "Name of the risk profile",
    example: "Aggressive Growth",
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: "Optional description of the risk profile",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Tolerance for risk",
    enum: RiskTolerance,
  })
  @IsOptional()
  @IsEnum(RiskTolerance)
  riskTolerance?: RiskTolerance;

  @ApiPropertyOptional({
    description: "Primary investment goal",
    enum: InvestmentGoal,
  })
  @IsOptional()
  @IsEnum(InvestmentGoal)
  investmentGoal?: InvestmentGoal;

  @ApiPropertyOptional({ description: "Target annual return", example: 0.1 })
  @IsOptional()
  @IsNumber()
  targetReturn?: number;

  @ApiPropertyOptional({
    description: "Maximum acceptable volatility",
    example: 0.2,
  })
  @IsOptional()
  @IsNumber()
  maxVolatility?: number;

  @ApiPropertyOptional({
    description: "Maximum acceptable drawdown",
    example: 0.15,
  })
  @IsOptional()
  @IsNumber()
  maxDrawdown?: number;

  @ApiPropertyOptional({
    description: "Investment horizon in years",
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  investmentHorizonYears?: number;

  @ApiPropertyOptional({
    description: "Minimum equity allocation",
    example: 0.6,
  })
  @IsOptional()
  @IsNumber()
  equityAllocationMin?: number;

  @ApiPropertyOptional({
    description: "Maximum equity allocation",
    example: 0.9,
  })
  @IsOptional()
  @IsNumber()
  equityAllocationMax?: number;

  @ApiPropertyOptional({ description: "Minimum bond allocation", example: 0.1 })
  @IsOptional()
  @IsNumber()
  bondAllocationMin?: number;

  @ApiPropertyOptional({ description: "Maximum bond allocation", example: 0.4 })
  @IsOptional()
  @IsNumber()
  bondAllocationMax?: number;

  @ApiPropertyOptional({
    description: "List of excluded assets",
    example: ["BND"],
  })
  @IsOptional()
  @IsArray()
  excludedAssets?: string[];

  @ApiPropertyOptional({
    description: "List of required assets",
    example: ["VOO"],
  })
  @IsOptional()
  @IsArray()
  requiredAssets?: string[];

  @ApiPropertyOptional({
    description: "Minimum ESG score for assets",
    example: 70,
  })
  @IsOptional()
  @IsNumber()
  minESGScore?: number;
}

export class UpdateRiskProfileDto {
  @ApiPropertyOptional({ description: "Name of the risk profile" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "Optional description of the risk profile",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Tolerance for risk",
    enum: RiskTolerance,
  })
  @IsOptional()
  @IsEnum(RiskTolerance)
  riskTolerance?: RiskTolerance;

  @ApiPropertyOptional({
    description: "Primary investment goal",
    enum: InvestmentGoal,
  })
  @IsOptional()
  @IsEnum(InvestmentGoal)
  investmentGoal?: InvestmentGoal;

  @ApiPropertyOptional({ description: "Target annual return" })
  @IsOptional()
  @IsNumber()
  targetReturn?: number;

  @ApiPropertyOptional({ description: "Maximum acceptable volatility" })
  @IsOptional()
  @IsNumber()
  maxVolatility?: number;

  @ApiPropertyOptional({ description: "Maximum acceptable drawdown" })
  @IsOptional()
  @IsNumber()
  maxDrawdown?: number;

  @ApiPropertyOptional({ description: "Investment horizon in years" })
  @IsOptional()
  @IsNumber()
  investmentHorizonYears?: number;

  @ApiPropertyOptional({ description: "List of excluded assets" })
  @IsOptional()
  @IsArray()
  excludedAssets?: string[];

  @ApiPropertyOptional({ description: "List of required assets" })
  @IsOptional()
  @IsArray()
  requiredAssets?: string[];

  @ApiPropertyOptional({ description: "Minimum ESG score for assets" })
  @IsOptional()
  @IsNumber()
  minESGScore?: number;
}

export class RiskProfileResponseDto {
  @ApiProperty({ description: "Unique identifier of the risk profile" })
  id: string;
  @ApiProperty({ description: "Name of the risk profile" })
  name: string;
  @ApiPropertyOptional({
    description: "Optional description of the risk profile",
  })
  description?: string;
  @ApiProperty({ description: "Tolerance for risk", enum: RiskTolerance })
  riskTolerance: RiskTolerance;
  @ApiProperty({ description: "Primary investment goal", enum: InvestmentGoal })
  investmentGoal: InvestmentGoal;
  @ApiProperty({ description: "Target annual return" })
  targetReturn: number;
  @ApiProperty({ description: "Maximum acceptable volatility" })
  maxVolatility: number;
  @ApiProperty({ description: "Maximum acceptable drawdown" })
  maxDrawdown: number;
  @ApiProperty({ description: "Target Sharpe ratio" })
  sharpeRatioTarget: number;
  @ApiProperty({ description: "Minimum equity allocation" })
  equityAllocationMin: number;
  @ApiProperty({ description: "Maximum equity allocation" })
  equityAllocationMax: number;
  @ApiProperty({ description: "Minimum bond allocation" })
  bondAllocationMin: number;
  @ApiProperty({ description: "Maximum bond allocation" })
  bondAllocationMax: number;
  @ApiProperty({ description: "Investment horizon in years" })
  investmentHorizonYears: number;
  @ApiProperty({
    description: "Whether to use machine learning for optimization",
  })
  useMachineLearning: boolean;
  @ApiProperty({ description: "Date of risk profile creation" })
  createdAt: Date;
  @ApiProperty({ description: "Date of last risk profile update" })
  updatedAt: Date;
}
