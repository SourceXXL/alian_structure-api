import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from '../../../common/database/entities/base.entity';
import { StorageBackendType } from './uploaded-file.entity';

export enum UploadSessionStatus {
  INITIATED = 'initiated',
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  ABORTED = 'aborted',
}

@Entity('upload_sessions')
export class UploadSessionEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  processedFileId?: string; // ID of the fully processed file after assembly

  @Column()
  filename: string;

  @Column('bigint')
  totalSize: number;

  @Column('bigint', { default: 0 })
  uploadedBytes: number;

  @Column({
    type: 'enum',
    enum: UploadSessionStatus,
    default: UploadSessionStatus.INITIATED,
  })
  status: UploadSessionStatus;

  @Column({ nullable: true })
  currentChunkNumber: number;

  @Column({ nullable: true })
  totalChunks: number;

  @Column({ type: 'jsonb', nullable: true })
  receivedChunks: number[]; // Array of chunk numbers that have been received

  @Column({ nullable: true })
  uploadedBy: string;

  @Column({ nullable: true })
  mimeType: string;

  @Column({ type: 'float', default: 0 })
  progress: number; // Percentage complete (0-100)

  @Column({ nullable: true })
  lastChunkReceivedAt?: Date;

  @Column({ nullable: true })
  completedAt?: Date;

  @Column({ nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  expiresAt: Date; // Session expires if not completed by this time

  @Column({
    type: 'enum',
    enum: StorageBackendType,
    default: StorageBackendType.LOCAL,
  })
  storageBackend: StorageBackendType;

  @Column({ default: false })
  encrypt: boolean;
}