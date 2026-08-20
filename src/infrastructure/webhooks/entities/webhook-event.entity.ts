import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum WebhookEventStatus {
  PENDING = "pending",
  DELIVERING = "delivering",
  DELIVERED = "delivered",
  FAILED = "failed",
}

@Entity("webhook_events")
export class WebhookEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  @Index()
  eventType: string;

  @Column({ type: "jsonb" })
  payload: Record<string, any>;

  @Column({ type: "varchar", length: 255, nullable: true })
  @Index()
  aggregateId?: string;

  @Column({
    type: "enum",
    enum: WebhookEventStatus,
    default: WebhookEventStatus.PENDING,
  })
  status: WebhookEventStatus;

  @Column({ type: "int", default: 0 })
  deliveryCount: number;

  @Column({ type: "int", default: 0 })
  successCount: number;

  @Column({ type: "int", default: 0 })
  failureCount: number;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
