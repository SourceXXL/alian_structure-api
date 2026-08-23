import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotificationChannel } from './notification.entity';

export enum DeliveryStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  BOUNCED = 'bounced',
  FAILED = 'failed',
  CLICKED = 'clicked',
  OPENED = 'opened',
}

@Entity('notification_delivery_logs')
@Index(['notificationId', 'channel'])
@Index(['userId', 'channel'])
@Index(['status'])
@Index(['createdAt'])
export class NotificationDeliveryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  notificationId: string;

  @Column()
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING,
  })
  status: DeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts: number;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  /** External provider message ID for tracking */
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerMessageId?: string;

  /** Which provider was used (smtp, sendgrid, twilio, fcm, etc.) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  provider?: string;

  /** Raw response from the delivery provider */
  @Column({ type: 'jsonb', nullable: true })
  providerResponse?: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  openedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  clickedAt?: Date;

  /** Time from send to delivery in milliseconds */
  @Column({ type: 'int', nullable: true })
  deliveryLatencyMs?: number;

  @CreateDateColumn()
  createdAt: Date;
}
