import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PriceFeedService } from "./services/price-feed.service";
import {
  GetHistoricalPricesDto,
  PriceResponseDto,
} from "./dto/price-feed.dto";
import { SupportedChain } from "./entities/price-record.entity";

@ApiTags("Price Feed")
@Controller("price-feed")
export class PriceFeedController {
  constructor(private readonly priceFeedService: PriceFeedService) {}

  @Get(":chain/:asset")
  @ApiOperation({ summary: "Get current aggregated price for an asset on a chain" })
  @ApiResponse({ status: 200, type: PriceResponseDto })
  async getCurrentPrice(
    @Param("chain") chain: SupportedChain,
    @Param("asset") asset: string,
  ): Promise<PriceResponseDto> {
    return this.priceFeedService.getCurrentPrice(asset, chain);
  }

  @Get(":chain/:asset/history")
  @ApiOperation({ summary: "Get historical prices for an asset on a chain" })
  @ApiResponse({ status: 200, type: [PriceResponseDto] })
  async getHistoricalPrices(
    @Param("chain") chain: SupportedChain,
    @Param("asset") asset: string,
    @Query() query: GetHistoricalPricesDto,
  ): Promise<PriceResponseDto[]> {
    return this.priceFeedService.getHistoricalPrices(
      asset,
      chain,
      query.limit,
    );
  }
}
