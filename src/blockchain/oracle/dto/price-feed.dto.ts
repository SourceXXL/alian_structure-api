import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsString, IsOptional, IsInt, Min, Max } from "class-validator";
import { SupportedChain, PriceSource } from "../entities/price-record.entity";

export class GetPriceDto {
  @ApiProperty({ example: "ETH", description: "Asset symbol" })
  @IsString()
  asset: string;

  @ApiProperty({ enum: SupportedChain, example: SupportedChain.ETHEREUM })
  @IsEnum(SupportedChain)
  chain: SupportedChain;
}

export class GetHistoricalPricesDto {
  @ApiProperty({ example: "ETH" })
  @IsString()
  asset: string;

  @ApiProperty({ enum: SupportedChain })
  @IsEnum(SupportedChain)
  chain: SupportedChain;

  @ApiPropertyOptional({ example: 100, default: 100, minimum: 1, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}

export class SourcePriceDto {
  @ApiPropertyOptional({ example: 2000.5 })
  chainlink?: number;

  @ApiPropertyOptional({ example: 2001.0 })
  band?: number;

  @ApiPropertyOptional({ example: 1999.8 })
  uniswap_twap?: number;
}

export class PriceResponseDto {
  @ApiProperty({ example: "ETH" })
  asset: string;

  @ApiProperty({ enum: SupportedChain })
  chain: SupportedChain;

  @ApiProperty({ example: 2000.43 })
  price: number;

  @ApiProperty({ type: SourcePriceDto })
  sourcePrices: Record<PriceSource, number>;

  @ApiProperty({ example: false })
  deviationAlert: boolean;

  @ApiProperty({ example: 0.0612 })
  maxDeviationPercent: number;

  @ApiProperty()
  timestamp: Date;
}
