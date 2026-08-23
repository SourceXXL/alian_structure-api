import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BacktestStatus } from "../entities/backtest-result.entity";

export class CreateBacktestDto {
  @ApiProperty({
    description: "Name of the backtest",
    example: "My Strategy Backtest",
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: "Optional description of the backtest" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "Start date of the backtest",
    example: "2022-01-01",
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: "End date of the backtest",
    example: "2023-01-01",
  })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    description: "Initial capital for the backtest",
    example: 10000,
  })
  @IsNumber()
  initialCapital: number;

  @ApiProperty({ description: "The strategy to backtest", example: "Momentum" })
  @IsString()
  strategy: string;

  @ApiProperty({
    description: "Assets and their weights for the backtest",
    example: [{ ticker: "BTC", weight: 1 }],
  })
  @IsArray()
  assets: Array<{ ticker: string; weight: number }>;

  @ApiPropertyOptional({
    description: "Benchmark ticker for comparison",
    example: "SPY",
  })
  @IsOptional()
  @IsString()
  benchmarkTicker?: string;

  @ApiPropertyOptional({
    description: "Rebalancing frequency in months",
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  rebalanceFrequency?: number; // months
}

export class BacktestResultResponseDto {
  @ApiProperty({ description: "Unique identifier of the backtest result" })
  id: string;
  @ApiProperty({ description: "Name of the backtest" })
  name: string;
  @ApiPropertyOptional({ description: "Optional description of the backtest" })
  description?: string;
  @ApiProperty({ description: "Status of the backtest", enum: BacktestStatus })
  status: BacktestStatus;
  @ApiProperty({ description: "Start date of the backtest" })
  startDate: Date;
  @ApiProperty({ description: "End date of the backtest" })
  endDate: Date;
  @ApiProperty({ description: "Initial capital for the backtest" })
  initialCapital: number;
  @ApiPropertyOptional({ description: "Final value of the portfolio" })
  finalValue?: number;
  @ApiPropertyOptional({ description: "Total return of the backtest" })
  totalReturn?: number;
  @ApiPropertyOptional({ description: "Annualized return of the backtest" })
  annualizedReturn?: number;
  @ApiPropertyOptional({ description: "Volatility of the backtest" })
  volatility?: number;
  @ApiPropertyOptional({ description: "Sharpe ratio of the backtest" })
  sharpeRatio?: number;
  @ApiPropertyOptional({ description: "Sortino ratio of the backtest" })
  sortinoRatio?: number;
  @ApiPropertyOptional({ description: "Maximum drawdown of the backtest" })
  maxDrawdown?: number;
  @ApiPropertyOptional({ description: "Return of the benchmark" })
  benchmarkReturn?: number;
  @ApiPropertyOptional({ description: "Alpha of the backtest" })
  alpha?: number;
  @ApiPropertyOptional({ description: "Beta of the backtest" })
  beta?: number;
  @ApiPropertyOptional({
    description: "Correlation of the backtest with the benchmark",
  })
  Correlation?: number;
  @ApiPropertyOptional({
    description: "Total number of trades in the backtest",
  })
  totalTrades?: number;
  @ApiPropertyOptional({
    description: "Win rate of the trades in the backtest",
  })
  winRate?: number;
  @ApiPropertyOptional({ description: "Profit factor of the backtest" })
  profitFactor?: number;
  @ApiProperty({ description: "Date of backtest creation" })
  createdAt: Date;
  @ApiPropertyOptional({ description: "Date of backtest completion" })
  completedAt?: Date;
}
