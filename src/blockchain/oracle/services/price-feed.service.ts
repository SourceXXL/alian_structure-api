import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { JsonRpcProvider, Contract } from "ethers";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  PriceRecord,
  SupportedChain,
  PriceSource,
} from "../entities/price-record.entity";
import { PriceResponseDto } from "../dto/price-feed.dto";

/** Chainlink AggregatorV3Interface — only latestRoundData needed */
const CHAINLINK_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];

/** Band Protocol StdReference */
const BAND_ABI = [
  "function getReferenceData(string base, string quote) external view returns (uint256 rate, uint256 lastUpdatedBase, uint256 lastUpdatedQuote)",
];

/** Uniswap V3 Pool — for TWAP via slot0 + observe */
const UNISWAP_V3_POOL_ABI = [
  "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

/** DEVIATION_THRESHOLD for alerting (5%) */
const DEVIATION_THRESHOLD_PERCENT = 5;

/** Well-known contract addresses per chain */
const CHAIN_CONTRACTS: Record<
  SupportedChain,
  {
    rpcEnvKey: string;
    chainId: number;
    chainlink: Record<string, string>;
    band?: string;
    uniswapV3Pools?: Record<string, string>;
  }
> = {
  [SupportedChain.ETHEREUM]: {
    rpcEnvKey: "ETH_RPC_URL",
    chainId: 1,
    chainlink: {
      ETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      BTC: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
      LINK: "0x2c1d072e956AFFC0D435Cb7AC308d97e0D8adf3B",
    },
    band: "0xDA7a001b254CD22e46d3eAB04d937489c93174C3",
    uniswapV3Pools: {
      ETH: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", // ETH/USDC 0.05%
    },
  },
  [SupportedChain.BSC]: {
    rpcEnvKey: "BSC_RPC_URL",
    chainId: 56,
    chainlink: {
      BNB: "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
      ETH: "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
      BTC: "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf",
    },
    band: "0xDA7a001b254CD22e46d3eAB04d937489c93174C3",
  },
  [SupportedChain.POLYGON]: {
    rpcEnvKey: "POLY_RPC_URL",
    chainId: 137,
    chainlink: {
      ETH: "0xF9680D99D6C9589e2a93a78A04A279e509205945",
      BTC: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
      MATIC: "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0",
    },
    band: "0xDA7a001b254CD22e46d3eAB04d937489c93174C3",
  },
  [SupportedChain.ARBITRUM]: {
    rpcEnvKey: "ARB_RPC_URL",
    chainId: 42161,
    chainlink: {
      ETH: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
      BTC: "0x6ce185960375d0D8B66bEBDAf4c8e1b0ed0A4728",
    },
  },
  [SupportedChain.OPTIMISM]: {
    rpcEnvKey: "OPT_RPC_URL",
    chainId: 10,
    chainlink: {
      ETH: "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
      BTC: "0xD702DD976Fb76Fffc2D3963D037dfDae5b04E593",
    },
  },
  [SupportedChain.AVALANCHE]: {
    rpcEnvKey: "AVAX_RPC_URL",
    chainId: 43114,
    chainlink: {
      AVAX: "0x0A77230d17318075983913bC2145DB16C7366156",
      ETH: "0x976B3D034E162d8bD72D6b9C989d545b839003b0",
      BTC: "0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743",
    },
  },
};

/** 30-minute TWAP window */
const TWAP_SECONDS = 1800;

@Injectable()
export class PriceFeedService {
  private readonly logger = new Logger(PriceFeedService.name);
  private readonly providers = new Map<SupportedChain, JsonRpcProvider>();

  constructor(
    @InjectRepository(PriceRecord)
    private readonly priceRecordRepository: Repository<PriceRecord>,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.initProviders();
  }

  private initProviders(): void {
    for (const [chain, cfg] of Object.entries(CHAIN_CONTRACTS)) {
      const url = this.configService.get<string>(cfg.rpcEnvKey);
      if (url) {
        this.providers.set(chain as SupportedChain, new JsonRpcProvider(url));
      }
    }
  }

  /**
   * Fetch the current price for an asset on a chain, aggregate from all
   * available sources, compute median, persist, and alert on deviation.
   */
  async getCurrentPrice(
    asset: string,
    chain: SupportedChain,
  ): Promise<PriceResponseDto> {
    const prices = await this.fetchAllSources(asset, chain);

    if (Object.keys(prices).length === 0) {
      throw new Error(
        `No price sources available for ${asset} on ${chain}. Configure RPC URLs.`,
      );
    }

    const { median, maxDeviationPercent } = this.aggregatePrices(prices);
    const deviationAlert = maxDeviationPercent > DEVIATION_THRESHOLD_PERCENT;

    if (deviationAlert) {
      this.eventEmitter.emit("price.deviation", {
        asset,
        chain,
        prices,
        maxDeviationPercent,
      });
      this.logger.warn(
        `Price deviation alert: ${asset}/${chain} — max deviation ${maxDeviationPercent.toFixed(2)}%`,
      );
    }

    const record = this.priceRecordRepository.create({
      asset: asset.toUpperCase(),
      chain,
      price: median,
      sourcePrices: prices as Record<PriceSource, number>,
      deviationAlert,
      maxDeviationPercent,
    });

    const saved = await this.priceRecordRepository.save(record);
    return this.toResponseDto(saved);
  }

  /**
   * Return stored historical prices for an asset/chain pair.
   */
  async getHistoricalPrices(
    asset: string,
    chain: SupportedChain,
    limit = 100,
  ): Promise<PriceResponseDto[]> {
    const records = await this.priceRecordRepository.find({
      where: { asset: asset.toUpperCase(), chain },
      order: { createdAt: "DESC" },
      take: limit,
    });
    return records.map((r) => this.toResponseDto(r));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchAllSources(
    asset: string,
    chain: SupportedChain,
  ): Promise<Partial<Record<PriceSource, number>>> {
    const provider = this.providers.get(chain);
    const cfg = CHAIN_CONTRACTS[chain];
    const prices: Partial<Record<PriceSource, number>> = {};

    if (!provider) {
      return prices;
    }

    const ticker = asset.toUpperCase();

    await Promise.allSettled([
      // Chainlink
      (async () => {
        const feedAddress = cfg.chainlink?.[ticker];
        if (!feedAddress) return;
        const feed = new Contract(feedAddress, CHAINLINK_ABI, provider);
        const [roundData, decimals] = await Promise.all([
          feed.latestRoundData(),
          feed.decimals(),
        ]);
        prices[PriceSource.CHAINLINK] =
          Number(roundData.answer) / 10 ** Number(decimals);
      })(),

      // Band Protocol
      (async () => {
        if (!cfg.band) return;
        const ref = new Contract(cfg.band, BAND_ABI, provider);
        const data = await ref.getReferenceData(ticker, "USD");
        // Band returns rate with 18 decimals
        prices[PriceSource.BAND] = Number(data.rate) / 1e18;
      })(),

      // Uniswap V3 TWAP
      (async () => {
        const poolAddress = cfg.uniswapV3Pools?.[ticker];
        if (!poolAddress) return;
        const pool = new Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
        const [token0, observations] = await Promise.all([
          pool.token0(),
          pool.observe([TWAP_SECONDS, 0]),
        ]);
        const [tickCumulativeOld, tickCumulativeNew] =
          observations.tickCumulatives;
        const avgTick =
          (Number(tickCumulativeNew) - Number(tickCumulativeOld)) /
          TWAP_SECONDS;
        // tick → price: price = 1.0001^tick
        // token0 is USDC on ETH/USDC pool, so price is inverted
        const rawPrice = Math.pow(1.0001, avgTick);
        // USDC has 6 decimals, WETH has 18 — adjust
        const adjustedPrice = (1 / rawPrice) * 1e12;
        prices[PriceSource.UNISWAP_TWAP] = adjustedPrice;
        void token0; // used for context, suppress lint
      })(),
    ]);

    return prices;
  }

  /**
   * Compute median and max pairwise deviation from a set of prices.
   */
  aggregatePrices(prices: Partial<Record<PriceSource, number>>): {
    median: number;
    maxDeviationPercent: number;
  } {
    const values = Object.values(prices).filter(
      (v): v is number => typeof v === "number" && isFinite(v) && v > 0,
    );

    if (values.length === 0) {
      return { median: 0, maxDeviationPercent: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

    let maxDeviationPercent = 0;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const avg = (values[i] + values[j]) / 2;
        const dev = avg > 0 ? (Math.abs(values[i] - values[j]) / avg) * 100 : 0;
        if (dev > maxDeviationPercent) maxDeviationPercent = dev;
      }
    }

    return { median, maxDeviationPercent };
  }

  private toResponseDto(record: PriceRecord): PriceResponseDto {
    return {
      asset: record.asset,
      chain: record.chain,
      price: Number(record.price),
      sourcePrices: record.sourcePrices,
      deviationAlert: record.deviationAlert,
      maxDeviationPercent: Number(record.maxDeviationPercent),
      timestamp: record.createdAt,
    };
  }
}
