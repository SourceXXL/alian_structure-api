import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { UploadedFile } from "./uploaded-file.entity";

export enum ScanStatus {
  PENDING = "pending",
  SCANNING = "scanning",
  CLEAN = "clean",
  INFECTED = "infected",
  ERROR = "error",
}

@Entity("file_scan_results")
export class FileScanResult {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  fileId: string;

  @ManyToOne(() => UploadedFile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "fileId" })
  file: UploadedFile;

  @Column({ type: "varchar", length: 128 })
  engine: string;

  @Column({ type: "varchar", length: 32 })
  engineVersion: string;

  @Column({
    type: "enum",
    enum: ScanStatus,
    default: ScanStatus.PENDING,
  })
  @Index()
  status: ScanStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  threatName?: string;

  @Column({ type: "jsonb", nullable: true })
  details?: Record<string, any>;

  @Column({ type: "int", nullable: true })
  scanDurationMs?: number;

  @CreateDateColumn()
  createdAt: Date;
}
