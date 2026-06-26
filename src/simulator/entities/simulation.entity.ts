import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum SimulationStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export enum SupportedChain {
  ETHEREUM = "ethereum",
  POLYGON = "polygon",
  ARBITRUM = "arbitrum",
  OPTIMISM = "optimism",
}

@Entity("simulations")
export class Simulation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userId: string;

  @Column({ type: "varchar", default: SupportedChain.ETHEREUM })
  chain: SupportedChain;

  @Column({ type: "bigint" })
  forkBlockNumber: number;

  @Column({ type: "int", default: 0 })
  blocksToSimulate: number;

  @Column({ type: "varchar", default: SimulationStatus.PENDING })
  status: SimulationStatus;

  @Column({ type: "jsonb", nullable: true })
  agentActions: Record<string, unknown>[];

  @Column({ type: "jsonb", nullable: true })
  gasReport: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  comparisonReport: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  errorMessage: string;

  @Column({ type: "int", default: 0 })
  blocksProcessed: number;

  @Column({ type: "bigint", nullable: true })
  durationMs: number;

  /** Speed multiplier for time-scaled simulation (e.g. 10 = 10x faster than real-time) */
  @Column({ type: "float", default: 1 })
  timeScaleFactor: number;

  /** Specific transaction hashes to replay during simulation */
  @Column({ type: "jsonb", nullable: true })
  replayTxHashes: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
