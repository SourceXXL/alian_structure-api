import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsJSON,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  OptimizationMethod,
  OptimizationStatus,
} from "../entities/optimization-history.entity";

export class CreateOptimizationDto {
  @ApiProperty({
    description: "The optimization method to use",
    enum: OptimizationMethod,
  })
  @IsEnum(OptimizationMethod)
  method: OptimizationMethod;

  @ApiProperty({ description: "ID of the portfolio to optimize" })
  @IsString()
  portfolioId: string;

  @ApiPropertyOptional({
    description: "Parameters for the optimization method",
  })
  @IsOptional()
  @IsJSON()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({
    description: "ID of the risk profile to use for optimization",
  })
  @IsOptional()
  @IsString()
  riskProfileId?: string;

  @ApiPropertyOptional({ description: "Target return for the optimization" })
  @IsOptional()
  @IsNumber()
  targetReturn?: number;

  @ApiPropertyOptional({
    description: "Maximum volatility for the optimization",
  })
  @IsOptional()
  @IsNumber()
  maxVolatility?: number;

  @ApiPropertyOptional({ description: "Constraints for the optimization" })
  @IsOptional()
  @IsArray()
  constraints?: Array<{ asset: string; min: number; max: number }>;
}

export class ApproveOptimizationDto {
  @ApiProperty({ description: "ID of the optimization to approve" })
  @IsString()
  optimizationId: string;

  @ApiPropertyOptional({ description: "Optional notes for the approval" })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectOptimizationDto {
  @ApiProperty({ description: "ID of the optimization to reject" })
  @IsString()
  optimizationId: string;

  @ApiProperty({ description: "Reason for rejecting the optimization" })
  @IsString()
  rejectionReason: string;
}

export class ImplementOptimizationDto {
  @ApiProperty({ description: "ID of the optimization to implement" })
  @IsString()
  optimizationId: string;

  @ApiPropertyOptional({ description: "Optional notes for the implementation" })
  @IsOptional()
  @IsString()
  executionNotes?: string;
}

export class OptimizationHistoryResponseDto {
  @ApiProperty({
    description: "Unique identifier of the optimization history record",
  })
  id: string;
  @ApiProperty({
    description: "The optimization method used",
    enum: OptimizationMethod,
  })
  method: OptimizationMethod;
  @ApiProperty({
    description: "Status of the optimization",
    enum: OptimizationStatus,
  })
  status: OptimizationStatus;
  @ApiProperty({
    description: "Suggested asset allocation from the optimization",
  })
  suggestedAllocation: Record<string, number>;
  @ApiPropertyOptional({
    description: "Expected return of the optimized portfolio",
  })
  expectedReturn?: number;
  @ApiPropertyOptional({
    description: "Expected volatility of the optimized portfolio",
  })
  expectedVolatility?: number;
  @ApiPropertyOptional({
    description: "Expected Sharpe ratio of the optimized portfolio",
  })
  expectedSharpeRatio?: number;
  @ApiPropertyOptional({
    description: "Value at Risk (VaR) of the optimized portfolio",
  })
  valueAtRisk?: number;
  @ApiPropertyOptional({
    description: "Maximum drawdown of the optimized portfolio",
  })
  maxDrawdown?: number;
  @ApiPropertyOptional({ description: "Improvement score of the optimization" })
  improvementScore?: number;
  @ApiPropertyOptional({
    description: "Backtested metrics of the optimized portfolio",
  })
  backtestedMetrics?: Record<string, number>;
  @ApiProperty({ description: "Date of optimization creation" })
  createdAt: Date;
  @ApiPropertyOptional({ description: "Date of optimization completion" })
  completedAt?: Date;
  @ApiPropertyOptional({ description: "Date of optimization implementation" })
  implementedAt?: Date;
}
