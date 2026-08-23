import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
  WEBHOOK = 'webhook',
  IN_APP = 'in_app',
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum NotificationStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  SCHEDULED = 'scheduled',
}

export enum NotificationCategory {
  SYSTEM = 'system',
  SECURITY = 'security',
  TRANSACTION = 'transaction',
  PORTFOLIO = 'portfolio',
  ALERT = 'alert',
  MARKETING = 'marketing',
  SOCIAL = 'social',
  BILLING = 'billing',
  COMPLIANCE = 'compliance',
}

@Entity('notifications')
@Index(['userId', 'readAt'])
@Index(['userId', 'category'])
@Index(['userId', 'createdAt'])
@Index(['scheduledAt', 'status'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'text', nullable: true })
  htmlBody?: string;

  @Column({
    type: 'enum',
    enum: NotificationCategory,
    default: NotificationCategory.SYSTEM,
  })
  category: NotificationCategory;

  @Column({
    type: 'enum',
    enum: NotificationPriority,
    default: NotificationPriority.NORMAL,
  })
  priority: NotificationPriority;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  /** Primary delivery channel */
  @Column({
    type: 'enum',
    enum: NotificationChannel,
    default: NotificationChannel.IN_APP,
  })
  primaryChannel: NotificationChannel;

  /** All channels this notification should be delivered through */
  @Column({ type: 'simple-array', nullable: true })
  channels?: NotificationChannel[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  templateName?: string;

  @Column({ type: 'jsonb', nullable: true })
  templateVars?: Record<string, any>;

  /** Optional reference ID (e.g., alert ID, transaction ID, etc.) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  referenceId?: string;

  /** Type of the referenced entity */
  @Column({ type: 'varchar', length: 100, nullable: true })
  referenceType?: string;

  @Column({ type: 'boolean', default: false })
  @Index()
  read: boolean;

  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date;

  /** Click-through tracking: was the notification action link clicked? */
  @Column({ type: 'boolean', default: false })
  clicked: boolean;

  @Column({ type: 'timestamp', nullable: true })
  clickedAt?: Date;

  /** If scheduled for future delivery */
  @Column({ type: 'timestamp', nullable: true })
  @Index()
  scheduledAt?: Date;

  /** When delivery actually started */
  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  /** When delivery was confirmed */
  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'int', default: 5 })
  maxAttempts: number;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  /** Aggregation key: notifications with the same key within the cooldown window get collapsed */
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  aggregationKey?: string;

  @Column({ type: 'int', default: 0 })
  aggregationCount: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  deleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
