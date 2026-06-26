import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum SupportedChain {
  ETHEREUM = "ethereum",
  BSC = "bsc",
  POLYGON = "polygon",
  ARBITRUM = "arbitrum",
  OPTIMISM = "optimism",
  AVALANCHE = "avalanche",
}

export enum PriceSource {
  CHAINLINK = "chainlink",
  BAND = "band",
  UNISWAP_TWAP = "uniswap_twap",
}

@Entity("price_records")
@Index(["asset", "chain", "createdAt"])
@Index(["asset", "createdAt"])
export class PriceRecord {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** Asset symbol, e.g. "ETH", "BTC" */
  @Column({ type: "varchar", length: 20 })
  asset: string;

  @Column({ type: "enum", enum: SupportedChain })
  chain: SupportedChain;

  /** Canonical median price in USD */
  @Column({ type: "decimal", precision: 30, scale: 8 })
  price: number;

  /** Raw prices per source, e.g. { chainlink: 2000.5, band: 2001.0, uniswap_twap: 1999.8 } */
  @Column({ type: "jsonb" })
  sourcePrices: Record<PriceSource, number>;

  /** Whether a >5% deviation was detected between sources */
  @Column({ type: "boolean", default: false })
  deviationAlert: boolean;

  /** Max % deviation observed between sources */
  @Column({ type: "decimal", precision: 8, scale: 4, default: 0 })
  maxDeviationPercent: number;

  @CreateDateColumn()
  createdAt: Date;
}
