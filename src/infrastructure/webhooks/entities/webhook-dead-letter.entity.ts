import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("webhook_dead_letters")
export class WebhookDeadLetter {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  deliveryId: string;

  @Column({ type: "uuid" })
  @Index()
  subscriptionId: string;

  @Column({ type: "uuid" })
  @Index()
  eventId: string;

  @Column({ type: "varchar", length: 2048 })
  url: string;

  @Column({ type: "jsonb" })
  eventPayload: Record<string, any>;

  @Column({ type: "jsonb" })
  requestHeaders: Record<string, string>;

  @Column({ type: "int", nullable: true })
  lastStatusCode?: number;

  @Column({ type: "text", nullable: true })
  lastErrorMessage?: string;

  @Column({ type: "int" })
  totalAttempts: number;

  @Column({ type: "varchar", length: 255 })
  userId: string;

  @Column({ type: "jsonb", nullable: true })
  allAttempts?: Array<{
    attempt: number;
    statusCode?: number;
    error?: string;
    durationMs: number;
    timestamp: string;
  }>;

  @Column({ type: "boolean", default: false })
  retried: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
