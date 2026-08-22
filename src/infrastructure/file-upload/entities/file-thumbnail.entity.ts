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

@Entity("file_thumbnails")
export class FileThumbnail {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  fileId: string;

  @ManyToOne(() => UploadedFile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "fileId" })
  file: UploadedFile;

  @Column({ type: "varchar", length: 255 })
  storedName: string;

  @Column({ type: "varchar", length: 2048 })
  storagePath: string;

  @Column({ type: "int" })
  width: number;

  @Column({ type: "int" })
  height: number;

  @Column({ type: "varchar", length: 32 })
  format: string;

  @Column({ type: "bigint" })
  size: number;

  @Column({ type: "varchar", length: 64 })
  variant: string;

  @CreateDateColumn()
  createdAt: Date;
}
