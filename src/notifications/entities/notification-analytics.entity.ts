import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotificationChannel } from './notification.entity';

/**
 * Aggregated analytics snapshot, computed periodically from delivery logs.
 * Each row represents a time-bucket (e.g., hourly or daily) for a given channel and category.
 */
@Entity('notification_analytics')
@Index(['dateBucket', 'channel', 'category'], { unique: true })
export class NotificationAnalytics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Start of the time bucket (truncated to hour or day) */
  @Column({ type: 'timestamp' })
  @Index()
  dateBucket: Date;

  /** Granularity: 'hourly' or 'daily' */
  @Column({ type: 'varchar', length: 20 })
  granularity: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category?: string;

  /** Number of notifications attempted in this bucket */
  @Column({ type: 'int', default: 0 })
  totalSent: number;

  /** Successfully delivered */
  @Column({ type: 'int', default: 0 })
  totalDelivered: number;

  /** Failed delivery attempts */
  @Column({ type: 'int', default: 0 })
  totalFailed: number;

  /** Bounced (email hard/soft bounce, invalid phone, etc.) */
  @Column({ type: 'int', default: 0 })
  totalBounced: number;

  /** Unique users who received a notification */
  @Column({ type: 'int', default: 0 })
  uniqueRecipients: number;

  /** Notifications that were opened (email open pixel, push tap, etc.) */
  @Column({ type: 'int', default: 0 })
  totalOpened: number;

  /** Notifications where user clicked an action link */
  @Column({ type: 'int', default: 0 })
  totalClicked: number;

  /** Aggregated notifications collapsed */
  @Column({ type: 'int', default: 0 })
  totalAggregated: number;

  /** P95 delivery latency in ms */
  @Column({ type: 'int', nullable: true })
  p95DeliveryLatencyMs?: number;

  /** Average delivery latency in ms */
  @Column({ type: 'int', nullable: true })
  avgDeliveryLatencyMs?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
