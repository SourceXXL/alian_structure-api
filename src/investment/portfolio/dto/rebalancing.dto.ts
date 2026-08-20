import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsJSON,
  IsDateString,
  IsBoolean,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  RebalanceTrigger,
  RebalanceStatus,
} from "../entities/rebalancing-event.entity";

export class TriggerRebalancingDto {
  @ApiProperty({ description: "ID of the portfolio to rebalance" })
  @IsString()
  portfolioId: string;

  @ApiProperty({
    description: "The trigger for the rebalancing event",
    enum: RebalanceTrigger,
  })
  @IsEnum(RebalanceTrigger)
  trigger: RebalanceTrigger;

  @ApiPropertyOptional({ description: "Reason for the rebalancing trigger" })
  @IsOptional()
  @IsString()
  triggerReason?: string;

  @ApiPropertyOptional({ description: "Custom allocation for the rebalancing" })
  @IsOptional()
  @IsJSON()
  customAllocation?: Record<string, number>;
}

export class ApproveRebalancingDto {
  @ApiProperty({ description: "ID of the rebalancing event to approve" })
  @IsString()
  rebalancingEventId: string;

  @ApiPropertyOptional({ description: "Optional notes for the approval" })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ExecuteRebalancingDto {
  @ApiProperty({ description: "ID of the rebalancing event to execute" })
  @IsString()
  rebalancingEventId: string;

  @ApiPropertyOptional({ description: "Optional notes for the execution" })
  @IsOptional()
  @IsString()
  executionNotes?: string;

  @ApiPropertyOptional({
    description: "Actual cost of the rebalancing execution",
  })
  @IsOptional()
  @IsNumber()
  actualCost?: number;

  @ApiPropertyOptional({
    description: "Slippage during the rebalancing execution",
  })
  @IsOptional()
  @IsNumber()
  executionSlippage?: number;

  @ApiPropertyOptional({
    description: "Perform a dry run without executing trades",
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class ScheduleRebalancingDto {
  @ApiProperty({
    description: "Frequency of the rebalancing schedule",
    enum: ["daily", "weekly", "monthly", "custom"],
  })
  @IsEnum(["daily", "weekly", "monthly", "custom"])
  frequency: "daily" | "weekly" | "monthly" | "custom";

  @ApiPropertyOptional({ description: "Cron expression for custom schedules" })
  @IsOptional()
  @IsString()
  cron?: string;
}

export class CancelRebalancingDto {
  @ApiProperty({ description: "ID of the rebalancing event to cancel" })
  @IsString()
  rebalancingEventId: string;

  @ApiProperty({ description: "Reason for cancelling the rebalancing event" })
  @IsString()
  reason: string;
}

export class RebalancingEventResponseDto {
  @ApiProperty({ description: "Unique identifier of the rebalancing event" })
  id: string;
  @ApiProperty({
    description: "The trigger for the rebalancing event",
    enum: RebalanceTrigger,
  })
  trigger: RebalanceTrigger;
  @ApiProperty({
    description: "Status of the rebalancing event",
    enum: RebalanceStatus,
  })
  status: RebalanceStatus;
  @ApiPropertyOptional({ description: "Reason for the rebalancing trigger" })
  triggerReason?: string;
  @ApiProperty({ description: "Asset allocation before rebalancing" })
  allocationBefore: Record<string, number>;
  @ApiProperty({ description: "Asset allocation after rebalancing" })
  allocationAfter: Record<string, number>;
  @ApiProperty({ description: "List of trades executed during rebalancing" })
  trades: Array<any>;
  @ApiPropertyOptional({ description: "Estimated cost of rebalancing" })
  estimatedCost?: number;
  @ApiPropertyOptional({ description: "Actual cost of rebalancing" })
  actualCost?: number;
  @ApiPropertyOptional({
    description: "Maximum allocation drift before rebalancing",
  })
  maxAllocationDrift?: number;
  @ApiPropertyOptional({
    description: "Expected return improvement from rebalancing",
  })
  expectedReturnImprovement?: number;
  @ApiPropertyOptional({
    description: "Change in portfolio volatility after rebalancing",
  })
  volatilityChange?: number;
  @ApiProperty({ description: "Date of rebalancing event creation" })
  createdAt: Date;
  @ApiPropertyOptional({ description: "Date of rebalancing execution" })
  executedAt?: Date;
  @ApiPropertyOptional({ description: "Date of rebalancing completion" })
  completedAt?: Date;
}
