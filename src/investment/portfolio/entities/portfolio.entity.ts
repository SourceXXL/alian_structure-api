import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { PortfolioAsset } from "./portfolio-asset.entity";
import { OptimizationHistory } from "./optimization-history.entity";
import { RebalancingEvent } from "./rebalancing-event.entity";
import { PerformanceMetric } from "./performance-metric.entity";
import { Transaction } from "./transaction.entity";
import { User } from "src/core/user/entities/user.entity";

export enum PortfolioStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  ARCHIVED = "archived",
}

export enum PortfolioType {
  MANUAL = "manual",
  AUTOMATED = "automated",
  TRADING = "trading",
  HODL = "hodl",
  OTHER = "other",
}

export enum AllocationStrategy {
  MANUAL = "manual",
  EQUAL_WEIGHT = "equal_weight",
  MARKET_CAP = "market_cap",
  RISK_PARITY = "risk_parity",
  MVO = "mvo",
  CUSTOM = "custom",
}

@Entity("portfolios")
@Index(["userId", "status"])
@Index(["userId", "createdAt"])
export class Portfolio {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({
    type: "enum",
    enum: PortfolioType,
    default: PortfolioType.MANUAL,
  })
  type: PortfolioType;

  description: string;

  @Column({
    type: "enum",
    enum: PortfolioStatus,
    default: PortfolioStatus.ACTIVE,
  })
  status: PortfolioStatus;

  @Column({ type: "jsonb", default: {} })
  initialAllocation: Record<string, number>;

  @Column({ type: "enum", enum: AllocationStrategy, default: AllocationStrategy.MANUAL, nullable: true })
  allocationStrategy: AllocationStrategy;

  @Column({ type: "decimal", precision: 18, scale: 2, default: 0 })
  totalValue: number;

  // ROI calculation
  @Column({ type: "decimal", precision: 10, scale: 4, nullable: true })
  roi: number;

  // Current allocation in JSON format
  @Column({ type: "jsonb", default: {} })
  currentAllocation: Record<string, number>;

  @Column({ type: "jsonb", nullable: true })
  targetAllocation: Record<string, number>;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any>;

  @Column({ type: "boolean", default: false })
  autoRebalanceEnabled: boolean;

  @Column({ type: "varchar", nullable: true })
  rebalanceFrequency: "daily" | "weekly" | "monthly" | "quarterly" | null;

  @Column({ type: "decimal", precision: 5, scale: 2, default: 5 })
  rebalanceThreshold: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt: Date;

  @Column({ nullable: true })
  lastRebalanceDate: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Column("uuid")
  userId: string;

  @OneToMany(() => PortfolioAsset, (asset) => asset.portfolio, {
    cascade: true,
  })
  assets: PortfolioAsset[];

  @OneToMany(() => Transaction, (tx) => tx.portfolio, {
    cascade: true,
  })
  transactions: Transaction[];

  @OneToMany(() => OptimizationHistory, (history) => history.portfolio, {
    cascade: true,
  })
  optimizationHistory: OptimizationHistory[];

  @OneToMany(() => RebalancingEvent, (event) => event.portfolio, {
    cascade: true,
  })
  rebalancingEvents: RebalancingEvent[];

  @OneToMany(() => PerformanceMetric, (metric) => metric.portfolio, {
    cascade: true,
  })
  performanceMetrics: PerformanceMetric[];
}
