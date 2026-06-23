import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEnum,
    IsNumber,
    Min,
    Max,
    MaxLength,
    IsArray,
    ArrayMinSize,
    ArrayMaxSize,
  } from 'class-validator';
  import { Type } from 'class-transformer';
  
  export enum RiskTolerance {
    CONSERVATIVE = 'conservative',
    MODERATE = 'moderate',
    AGGRESSIVE = 'aggressive',
  }
  
  export enum RebalancingFrequency {
    DAILY = 'daily',
    WEEKLY = 'weekly',
    MONTHLY = 'monthly',
    QUARTERLY = 'quarterly',
    MANUAL = 'manual',
  }
  
  export class CreatePortfolioDto {
    @IsString()
    @IsNotEmpty({ message: 'Portfolio name is required.' })
    @MaxLength(100, { message: 'Portfolio name must not exceed 100 characters.' })
    name: string;
  
    @IsOptional()
    @IsString()
    @MaxLength(500, { message: 'Description must not exceed 500 characters.' })
    description?: string;
  
    @IsEnum(RiskTolerance, {
      message: `riskTolerance must be one of: ${Object.values(RiskTolerance).join(', ')}.`,
    })
    riskTolerance: RiskTolerance;
  
    @IsNumber({}, { message: 'initialBalance must be a number.' })
    @Min(0.01, { message: 'initialBalance must be greater than 0.' })
    @Type(() => Number)
    initialBalance: number;
  
    @IsOptional()
    @IsEnum(RebalancingFrequency, {
      message: `rebalancingFrequency must be one of: ${Object.values(RebalancingFrequency).join(', ')}.`,
    })
    rebalancingFrequency?: RebalancingFrequency;
  
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1, { message: 'At least one target asset must be provided.' })
    @ArrayMaxSize(50, { message: 'A portfolio may not exceed 50 target assets.' })
    @IsString({ each: true })
    targetAssetIds?: string[];
  }