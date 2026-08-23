import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('notification_aggregations')
@Index(['userId', 'aggregationKey'], { unique: true })
export class NotificationAggregation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  aggregationKey: string;

  /** How many notifications have been collapsed into this one */
  @Column({ type: 'int', default: 1 })
  count: number;

  /** The latest notification ID that was aggregated */
  @Column({ type: 'varchar', length: 36 })
  latestNotificationId: string;

  /** When the aggregation window started */
  @Column({ type: 'timestamp' })
  windowStartedAt: Date;

  /** When the last notification was added to this aggregation */
  @Column({ type: 'timestamp' })
  lastNotificationAt: Date;

  /** Cooldown in seconds: no new notifications with this key will be sent until the cooldown expires */
  @Column({ type: 'int', default: 300 })
  cooldownSeconds: number;

  /** Whether the aggregated notification has been sent */
  @Column({ type: 'boolean', default: false })
  sent: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
