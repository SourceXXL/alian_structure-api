import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  Max,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SupportedChain } from "../entities/simulation.entity";

export class CreateSimulationDto {
  @ApiProperty({
    enum: SupportedChain,
    default: SupportedChain.ETHEREUM,
    description: "Target chain to fork",
  })
  @IsEnum(SupportedChain)
  chain: SupportedChain;

  @ApiProperty({ description: "Block number to fork from (0 = latest)" })
  @IsInt()
  @Min(0)
  forkBlockNumber: number;

  @ApiProperty({ description: "Number of blocks to simulate", minimum: 1, maximum: 1000 })
  @IsInt()
  @IsPositive()
  @Max(1000)
  blocksToSimulate: number;

  @ApiPropertyOptional({
    description: "Time-scale multiplier — simulate N blocks per real second (default 1). Higher values fast-forward.",
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  timeScaleFactor?: number;
}

export class RunSimulationDto {
  @ApiPropertyOptional({ description: "Agent addresses to track during simulation" })
  @IsOptional()
  @IsString({ each: true })
  agentAddresses?: string[];

  @ApiPropertyOptional({ description: "Specific tx hashes to replay from historical chain data" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  replayTxHashes?: string[];
}
