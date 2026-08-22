import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum WebhookSubscriptionStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  DISABLED = "disabled",
}

@Entity("webhook_subscriptions")
export class WebhookSubscription {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  @Index()
  userId: string;

  @Column({ type: "varchar", length: 2048 })
  url: string;

  @Column({ type: "varchar", length: 64, unique: true })
  signingKey: string;

  @Column({ type: "simple-array" })
  events: string[];

  @Column({
    type: "enum",
    enum: WebhookSubscriptionStatus,
    default: WebhookSubscriptionStatus.ACTIVE,
  })
  status: WebhookSubscriptionStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  description?: string;

  @Column({ type: "int", default: 5 })
  maxRetries: number;

  @Column({ type: "int", default: 1000 })
  retryDelayMs: number;

  @Column({ type: "float", default: 2 })
  backoffMultiplier: number;

  @Column({ type: "int", default: 30000 })
  timeoutMs: number;

  @Column({ type: "int", default: 10 })
  rateLimitPerMinute: number;

  @Column({ type: "jsonb", nullable: true })
  headers?: Record<string, string>;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
