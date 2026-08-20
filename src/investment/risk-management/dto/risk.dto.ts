import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Max,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum RiskModel {
  VAR = "VaR",
  CVAR = "CVaR",
  SHARPE = "sharpe",
  DRAWDOWN = "drawdown",
}

export class RiskConfigDto {
  @ApiProperty({ description: "User ID for the risk configuration" })
  @IsString()
  userId: string;

  @ApiProperty({
    description: "Risk tolerance of the user",
    minimum: 0,
    maximum: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  riskTolerance: number;

  @ApiProperty({ description: "Maximum size of a single position", minimum: 0 })
  @IsNumber()
  @Min(0)
  maxPositionSize: number;

  @ApiProperty({ description: "Stop loss percentage", minimum: 0 })
  @IsNumber()
  @Min(0)
  stopLossPercentage: number;

  @ApiProperty({ description: "Take profit percentage", minimum: 0 })
  @IsNumber()
  @Min(0)
  takeProfitPercentage: number;

  @ApiPropertyOptional({ description: "Maximum drawdown allowed" })
  @IsOptional()
  @IsNumber()
  maxDrawdown?: number;
}

export class PortfolioRiskDto {
  @ApiProperty({ description: "User ID for the portfolio risk" })
  userId: string;
  @ApiProperty({ description: "Total value of the portfolio" })
  totalValue: number;
  @ApiProperty({ description: "Value at Risk (VaR) at 95% confidence" })
  var95: number;
  @ApiProperty({ description: "Value at Risk (VaR) at 99% confidence" })
  var99: number;
  @ApiProperty({
    description: "Conditional Value at Risk (CVaR) at 95% confidence",
  })
  cvar95: number;
  @ApiProperty({ description: "Sharpe ratio of the portfolio" })
  sharpeRatio: number;
  @ApiProperty({ description: "Maximum drawdown of the portfolio" })
  maxDrawdown: number;
  @ApiProperty({ description: "Current drawdown of the portfolio" })
  currentDrawdown: number;
  @ApiProperty({ description: "Diversification score of the portfolio" })
  diversificationScore: number;
  @ApiProperty({ description: "Overall risk score of the portfolio" })
  riskScore: number;
  @ApiProperty({ description: "List of risk alerts for the portfolio" })
  alerts: RiskAlertDto[];
  @ApiProperty({ description: "Date of the last risk calculation" })
  calculatedAt: Date;
}

export class RiskAlertDto {
  @ApiProperty({ description: "Type of the risk alert" })
  type:
    | "stop_loss"
    | "take_profit"
    | "drawdown"
    | "concentration"
    | "volatility";
  @ApiProperty({ description: "Severity of the risk alert" })
  severity: "low" | "medium" | "high" | "critical";
  @ApiProperty({ description: "Message of the risk alert" })
  message: string;
  @ApiPropertyOptional({ description: "Asset related to the risk alert" })
  asset?: string;
  @ApiProperty({ description: "Threshold for the risk alert" })
  threshold: number;
  @ApiProperty({ description: "Current value related to the risk alert" })
  currentValue: number;
  @ApiProperty({ description: "Date the risk alert was triggered" })
  triggeredAt: Date;
}

export class PositionSizeDto {
  @ApiProperty({ description: "User ID for the position size calculation" })
  @IsString()
  userId: string;

  @ApiProperty({ description: "Asset for the position size calculation" })
  @IsString()
  asset: string;

  @ApiProperty({ description: "Value of the portfolio", minimum: 0 })
  @IsNumber()
  @Min(0)
  portfolioValue: number;

  @ApiProperty({ description: "Volatility of the asset", minimum: 0 })
  @IsNumber()
  @Min(0)
  volatility: number;
}
