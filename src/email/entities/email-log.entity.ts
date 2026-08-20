import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum EmailProvider {
  SMTP = "smtp",
  SENDGRID = "sendgrid",
  SES = "ses",
}
export enum EmailStatus {
  QUEUED = "queued",
  SENDING = "sending",
  SENT = "sent",
  DELIVERED = "delivered",
  FAILED = "failed",
  BOUNCED = "bounced",
}

@Entity("email_logs")
export class EmailLog {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Column() recipientEmail: string;
  @Column() senderEmail: string;
  @Column() subject: string;
  @Column({ nullable: true }) templateName?: string;
  @Column({ type: "jsonb", nullable: true }) templateVars?: Record<string, any>;
  @Column({ type: "enum", enum: EmailProvider, default: EmailProvider.SMTP })
  provider: EmailProvider;
  @Column({ type: "enum", enum: EmailStatus, default: EmailStatus.QUEUED })
  status: EmailStatus;
  @Column({ nullable: true }) providerMessageId?: string;
  @Column({ type: "int", default: 0 }) attempts: number;
  @Column({ type: "int", default: 5 }) maxAttempts: number;
  @Column({ type: "timestamp", nullable: true }) lastAttemptAt?: Date;
  @Column({ type: "timestamp", nullable: true }) deliveredAt?: Date;
  @Column({ type: "text", nullable: true }) errorMessage?: string;
  @Column({ type: "jsonb", nullable: true }) metadata?: Record<string, any>;
  @Column({ type: "boolean", default: false }) unsubscribed: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
