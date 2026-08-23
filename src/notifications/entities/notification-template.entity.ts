import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  /** Which channel this template is for */
  @Column({ type: 'varchar', length: 50 })
  channel: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  subject?: string;

  @Column({ type: 'text', nullable: true })
  bodyTemplate: string;

  @Column({ type: 'text', nullable: true })
  htmlTemplate?: string;

  @Column({ type: 'text', nullable: true })
  smsTemplate?: string;

  /** Variables that can be used in the template: {name}, {amount}, etc. */
  @Column({ type: 'jsonb', nullable: true })
  variables?: string[];

  @Column({ type: 'varchar', length: 50, nullable: true })
  category?: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
