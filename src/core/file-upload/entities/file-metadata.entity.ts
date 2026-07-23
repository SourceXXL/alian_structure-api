import { Entity, Column, PrimaryGeneratedColumn, OneToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UploadedFileEntity } from './uploaded-file.entity';
import { BaseEntity } from '../../../common/database/entities/base.entity';

@Entity('file_metadata')
export class FileMetadataEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  width?: number; // For images

  @Column({ nullable: true })
  height?: number; // For images

  @Column({ nullable: true })
  duration?: number; // For videos/audio

  @Column({ type: 'jsonb', nullable: true })
  exif?: Record<string, any>; // EXIF data for images

  @Column({ type: 'jsonb', nullable: true })
  customMetadata?: Record<string, any>; // User-defined metadata

  @Column({ nullable: true })
  fileType: string; // General category: image, video, document, archive, etc.

  @Column({ nullable: true })
  format: string; // Specific format: jpeg, png, mp4, pdf, etc.

  @Column({ type: 'float', nullable: true })
  compressionRatio?: number;

  @Column({ nullable: true })
  bitDepth?: number;

  @Column({ nullable: true })
  colorSpace?: string;

  @Column({ type: 'jsonb', nullable: true })
  extractedText?: string; // OCR text for documents/images

  @Column({ type: 'tsvector', nullable: true })
  searchVector?: any; // PostgreSQL full-text search vector

  @OneToOne(() => UploadedFileEntity, (file) => file.metadata)
  file: UploadedFileEntity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}