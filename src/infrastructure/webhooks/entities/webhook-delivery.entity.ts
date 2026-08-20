import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum WebhookDeliveryStatus {
  PENDING = "pending",
  DELIVERING = "delivering",
  SUCCESS = "success",
  FAILED = "failed",
  DEAD_LETTERED = "dead_lettered",
}

@Entity("webhook_deliveries")
export class WebhookDelivery {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  subscriptionId: string;

  @Column({ type: "uuid" })
  @Index()
  eventId: string;

  @Column({
    type: "enum",
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  @Column({ type: "int", default: 0 })
  attempts: number;

  @Column({ type: "int", default: 5 })
  maxAttempts: number;

  @Column({ type: "int", nullable: true })
  statusCode?: number;

  @Column({ type: "text", nullable: true })
  responseBody?: string;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "int", default: 0 })
  durationMs: number;

  @Column({ type: "timestamp", nullable: true })
  lastAttemptAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  nextRetryAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  deliveredAt?: Date;

  @Column({ type: "jsonb", nullable: true })
  requestHeaders?: Record<string, string>;

  @Column({ type: "jsonb", nullable: true })
  responseHeaders?: Record<string, string>;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
