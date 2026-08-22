import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum FileStorageBackend {
  LOCAL = "local",
  S3 = "s3",
  AZURE_BLOB = "azure_blob",
}

export enum FileStatus {
  UPLOADING = "uploading",
  PROCESSING = "processing",
  READY = "ready",
  INFECTED = "infected",
  FAILED = "failed",
  DELETED = "deleted",
}

export enum FileCategory {
  IMAGE = "image",
  DOCUMENT = "document",
  VIDEO = "video",
  AUDIO = "audio",
  ARCHIVE = "archive",
  OTHER = "other",
}

@Entity("uploaded_files")
export class UploadedFile {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  @Index()
  userId: string;

  @Column({ type: "varchar", length: 255 })
  originalName: string;

  @Column({ type: "varchar", length: 255 })
  storedName: string;

  @Column({ type: "varchar", length: 512 })
  @Index()
  mimeType: string;

  @Column({ type: "bigint" })
  size: number;

  @Column({ type: "varchar", length: 255 })
  @Index()
  category: FileCategory;

  @Column({ type: "varchar", length: 64 })
  checksum: string;

  @Column({
    type: "enum",
    enum: FileStorageBackend,
    default: FileStorageBackend.LOCAL,
  })
  storageBackend: FileStorageBackend;

  @Column({ type: "varchar", length: 2048 })
  storagePath: string;

  @Column({ type: "varchar", length: 2048, nullable: true })
  storageBucket?: string;

  @Column({
    type: "enum",
    enum: FileStatus,
    default: FileStatus.UPLOADING,
  })
  @Index()
  status: FileStatus;

  @Column({ type: "varchar", length: 64, default: "clean" })
  scanStatus: string;

  @Column({ type: "timestamp", nullable: true })
  scannedAt?: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  scanEngine?: string;

  @Column({ type: "varchar", length: 512, nullable: true })
  @Index()
  encryptionKey?: string;

  @Column({ type: "boolean", default: false })
  encrypted: boolean;

  @Column({ type: "int", nullable: true })
  width?: number;

  @Column({ type: "int", nullable: true })
  height?: number;

  @Column({ type: "varchar", length: 32, nullable: true })
  format?: string;

  @Column({ type: "int", nullable: true })
  duration?: number;

  @Column({ type: "int", nullable: true })
  pageCount?: number;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  tags?: string[];

  @Column({ type: "varchar", length: 512, nullable: true })
  description?: string;

  @Column({ type: "int", default: 0 })
  downloadCount: number;

  @Column({ type: "boolean", default: false })
  @Index()
  isOrphaned: boolean;

  @Column({ type: "timestamp", nullable: true })
  expiresAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
