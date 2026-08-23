import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { NotificationCategory } from './notification.entity';

export enum NotificationChannelPreference {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  DIGEST = 'digest',
}

@Entity('notification_preferences')
@Index(['userId', 'category', 'channel'], { unique: true })
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: NotificationCategory,
  })
  category: NotificationCategory;

  /** Which channel (email, sms, push, webhook, in_app) */
  @Column({ type: 'varchar', length: 50 })
  channel: string;

  @Column({
    type: 'enum',
    enum: NotificationChannelPreference,
    default: NotificationChannelPreference.ENABLED,
  })
  preference: NotificationChannelPreference;

  /** For digest mode: how often to send digests (e.g., hourly, daily, weekly) */
  @Column({ type: 'varchar', length: 50, nullable: true })
  digestFrequency?: string;

  /** Quiet hours: start hour (0-23) in user's timezone */
  @Column({ type: 'int', nullable: true })
  quietHoursStart?: number;

  /** Quiet hours: end hour (0-23) in user's timezone */
  @Column({ type: 'int', nullable: true })
  quietHoursEnd?: number;

  /** User's timezone (IANA) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  timezone?: string;

  /** For email: the address to send to */
  @Column({ type: 'varchar', length: 255, nullable: true })
  emailAddress?: string;

  /** For SMS: the phone number */
  @Column({ type: 'varchar', length: 50, nullable: true })
  phoneNumber?: string;

  /** For push: device token */
  @Column({ type: 'text', nullable: true })
  pushToken?: string;

  /** For webhook: callback URL */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  webhookUrl?: string;

  /** Minimum priority level to trigger this channel */
  @Column({ type: 'varchar', length: 50, nullable: true })
  minPriority?: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
