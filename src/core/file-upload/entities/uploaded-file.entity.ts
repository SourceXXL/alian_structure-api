import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { FileMetadataEntity } from './file-metadata.entity';
import { BaseEntity } from '../../../common/database/entities/base.entity';

export enum StorageBackendType {
  LOCAL = 'local',
  S3 = 's3',
  AZURE_BLOB = 'azure_blob',
}

export enum FileStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  SCANNING = 'scanning',
  COMPLETED = 'completed',
  FAILED = 'failed',
  QUARANTINED = 'quarantined',
  DELETED = 'deleted',
}

@Entity('uploaded_files')
export class UploadedFileEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  @Column()
  storedFilename: string;

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  @Column({ default: 0 })
  downloadCount: number = 0;

  @Column('bigint')
  size: number;

  @Column()
  path: string;

  @Column()
  hash: string; // SHA-256 hash of file content for integrity verification

  @Column({
    type: 'enum',
    enum: StorageBackendType,
    default: StorageBackendType.LOCAL,
  })
  storageBackend: StorageBackendType;

  @Column({
    type: 'enum',
    enum: FileStatus,
    default: FileStatus.PENDING,
  })
  status: FileStatus;

  @Column({ default: false })
  encrypted: boolean;

  @Column({ nullable: true })
  encryptionKeyId?: string;

  @Column({ nullable: true })
  encryptionIv?: string;

  @Column({ nullable: true })
  encryptionTag?: string;

  @Column({ nullable: true })
  virusScanStatus?: string;

  @Column({ nullable: true })
  virusScanResult?: string;

  @Column({ default: false })
  virusScanned: boolean = false;

  @Column({ nullable: true })
  virusScanDate?: Date;

  @Column({ nullable: true })
  uploadedBy: string; // User ID of uploader

  @Column({ nullable: true })
  lastAccessedAt?: Date;

  @Column({ nullable: true })
  accessCount: number = 0;

  @Column({ nullable: true })
  isOrphaned: boolean = false;

  @Column({ default: false })
  markedForDeletion: boolean = false;

  @Column({ nullable: true })
  deletedAt?: Date;

  @Column({ nullable: true })
  orphanedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  thumbnailUrls?: Record<string, string>; // { '100x100': 'url', '200x200': 'url' }

  @OneToOne(() => FileMetadataEntity, (metadata) => metadata.file, {
    cascade: true,
    eager: true,
  })
  @JoinColumn()
  metadata: FileMetadataEntity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  expiresAt?: Date; // For temporary files
}