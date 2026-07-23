import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { StorageBackendFactory } from '../storage-backends/storage-backend.factory';
import { FileValidationService } from './file-validation.service';
import { VirusScannerService } from './virus-scanner.service';
import { ImageProcessingService } from './image-processing.service';
import { MetadataExtractorService } from './metadata-extractor.service';
import { EncryptionService } from './encryption.service';
import { UploadedFileEntity, StorageBackendType, FileStatus } from '../entities/uploaded-file.entity';
import { FileMetadataEntity } from '../entities/file-metadata.entity';
import { UploadSessionEntity, UploadSessionStatus } from '../entities/upload-session.entity';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { StorageFile, UploadOptions } from '../interfaces/storage-backend.interface';

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  constructor(
    @InjectRepository(UploadedFileEntity)
    private readonly fileRepository: Repository<UploadedFileEntity>,
    @InjectRepository(FileMetadataEntity)
    private readonly metadataRepository: Repository<FileMetadataEntity>,
    @InjectRepository(UploadSessionEntity)
    private readonly sessionRepository: Repository<UploadSessionEntity>,
    private readonly storageBackendFactory: StorageBackendFactory,
    private readonly validationService: FileValidationService,
    private readonly virusScanner: VirusScannerService,
    private readonly imageProcessor: ImageProcessingService,
    private readonly metadataExtractor: MetadataExtractorService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Main upload method that handles the complete upload pipeline
   */
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    options?: {
      storageBackend?: StorageBackendType;
      encrypt?: boolean;
      processImage?: boolean;
      generateThumbnails?: boolean;
    },
  ): Promise<UploadedFileEntity> {
    this.logger.log(`Starting upload process for file: ${originalName}`);
    
    // 1. Validate the file first
    const validationResult = await this.validationService.validateFile(buffer, originalName);
    if (!validationResult.valid) {
      throw new AppException(
        ErrorCodes.FILE_VALIDATION_FAILED,
        `File validation failed: ${validationResult.errors.join(', ')}`,
      );
    }

    // 2. Scan for viruses if enabled
    if (this.virusScanner.isEnabled()) {
      const scanResult = await this.virusScanner.scanFile(buffer, originalName);
      if (scanResult.infected) {
        throw new AppException(
          ErrorCodes.FILE_INFECTED,
          `File contains malware: ${scanResult.threats.join(', ')}`,
        );
      }
    }

    // 3. Process images if it's an image file and processing is enabled
    let processedBuffer = buffer;
    let thumbnails: Map<string, Buffer> | undefined;
    
    if (options?.processImage !== false && validationResult.actualMimeType?.startsWith('image/')) {
      try {
        const processedImage = await this.imageProcessor.processImage(buffer);
        processedBuffer = processedImage.buffer;
        
        if (options?.generateThumbnails !== false) {
          thumbnails = await this.imageProcessor.generateThumbnails(buffer);
        }
      } catch (error) {
        this.logger.warn(`Image processing failed, continuing with original file: ${(error as Error).message}`);
      }
    }

    // 4. Encrypt the file if requested
    let encryptionData: Awaited<ReturnType<typeof this.encryptionService.encrypt>> | undefined;
    if (options?.encrypt) {
      try {
        encryptionData = await this.encryptionService.encrypt(processedBuffer);
        processedBuffer = encryptionData.encryptedBuffer;
      } catch (error) {
        this.logger.error(`Encryption failed: ${(error as Error).message}`);
        throw new AppException(ErrorCodes.ENCRYPTION_FAILED, 'Failed to encrypt file');
      }
    }

    // 5. Extract metadata
    const extractedMetadata = await this.metadataExtractor.extractAll(processedBuffer, originalName);

    // 6. Get the appropriate storage backend
    const backend = this.storageBackendFactory.getBackend(options?.storageBackend);
    
    // 7. Prepare storage options
    const storageOptions: UploadOptions = {
      encrypt: options?.encrypt || false,
      metadata: {
        originalName,
        contentType: validationResult.actualMimeType || 'application/octet-stream',
        ...extractedMetadata.additional,
      },
    };

    // 8. Generate unique filename
    const fileId = uuidv4();
    const fileExtension = this.getFileExtension(originalName);
    const storedFilename = `${fileId}.${fileExtension}`;

    // 9. Upload to storage backend
    let storageFile: StorageFile;
    try {
      storageFile = await backend.upload(processedBuffer, storedFilename, storageOptions);
    } catch (error) {
      this.logger.error(`Storage upload failed: ${(error as Error).message}`);
      throw new AppException(ErrorCodes.STORAGE_UPLOAD_FAILED, 'Failed to upload file to storage');
    }

    // 10. Upload thumbnails if they were generated
    if (thumbnails) {
      for (const [key, thumbnailBuffer] of thumbnails.entries()) {
        const thumbnailFilename = `${fileId}_${key}`;
        try {
          await backend.upload(thumbnailBuffer, thumbnailFilename, {
            ...storageOptions,
            isThumbnail: true,
          });
        } catch (error) {
          this.logger.warn(`Failed to upload thumbnail ${key}: ${(error as Error).message}`);
        }
      }
    }

    // 11. Create database entities
    const fileEntity = new UploadedFileEntity();
    fileEntity.id = fileId;
    fileEntity.filename = originalName;
    fileEntity.storedFilename = storedFilename;
    fileEntity.storageBackend = options?.storageBackend || StorageBackendType.LOCAL;
    fileEntity.mimeType = validationResult.actualMimeType || 'application/octet-stream';
    fileEntity.size = storageFile.size;
    fileEntity.hash = storageFile.hash;
    fileEntity.encrypted = options?.encrypt || false;
    fileEntity.encryptionIv = encryptionData?.iv;
    fileEntity.encryptionTag = encryptionData?.tag;
    fileEntity.status = FileStatus.AVAILABLE;
    fileEntity.virusScanned = this.virusScanner.isEnabled();
    fileEntity.virusScanDate = this.virusScanner.isEnabled() ? new Date() : undefined;

    const metadataEntity = new FileMetadataEntity();
    metadataEntity.exif = extractedMetadata.exif;
    metadataEntity.extractedText = extractedMetadata.text;
    metadataEntity.searchVector = extractedMetadata.searchVector;
    metadataEntity.author = extractedMetadata.author;
    metadataEntity.title = extractedMetadata.title;
    metadataEntity.keywords = extractedMetadata.keywords;
    fileEntity.metadata = metadataEntity;

    // 12. Save to database
    await this.fileRepository.save(fileEntity);

    this.logger.log(`Successfully uploaded file ${originalName} with ID ${fileId}`);
    return fileEntity;
  }

  /**
   * Download a file with all necessary processing (decryption, etc.)
   */
  async downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    // 1. Get file from database
    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file) {
      throw new AppException(ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    if (file.status !== FileStatus.AVAILABLE) {
      throw new AppException(ErrorCodes.FILE_UNAVAILABLE, 'File is not available for download');
    }

    // 2. Get storage backend
    const backend = this.storageBackendFactory.getBackend(file.storageBackend as StorageBackendType);
    
    // 3. Download from storage
    let buffer: Buffer;
    try {
      const stream = await backend.download(file.storedFilename.split('.')[0]);
      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Download failed: ${(error as Error).message}`);
      throw new AppException(ErrorCodes.STORAGE_DOWNLOAD_FAILED, 'Failed to download file from storage');
    }

    // 4. Decrypt if necessary
    if (file.encrypted && file.encryptionIv && file.encryptionTag) {
      try {
        const decryptionResult = await this.encryptionService.decrypt(
          buffer,
          file.encryptionIv,
          file.encryptionTag,
        );
        buffer = decryptionResult.decryptedBuffer;
      } catch (error) {
        this.logger.error(`Decryption failed: ${(error as Error).message}`);
        throw new AppException(ErrorCodes.DECRYPTION_FAILED, 'Failed to decrypt file');
      }
    }

    return {
      buffer,
      mimeType: file.mimeType,
      filename: file.filename,
    };
  }

  /**
   * Delete a file from storage and database
   */
  async deleteFile(fileId: string): Promise<boolean> {
    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file) {
      throw new AppException(ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    // Delete from storage
    const backend = this.storageBackendFactory.getBackend(file.storageBackend as StorageBackendType);
    const deleted = await backend.delete(file.storedFilename.split('.')[0]);

    if (deleted) {
      // Delete from database
      await this.fileRepository.remove(file);
      this.logger.log(`Deleted file ${fileId}`);
    }

    return deleted;
  }

  /**
   * Get a signed download URL
   */
  async getSignedUrl(fileId: string, expiresIn?: number): Promise<string> {
    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file) {
      throw new AppException(ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    if (file.status !== FileStatus.AVAILABLE) {
      throw new AppException(ErrorCodes.FILE_UNAVAILABLE, 'File is not available for download');
    }

    const backend = this.storageBackendFactory.getBackend(file.storageBackend as StorageBackendType);
    return backend.getSignedUrl(file.storedFilename.split('.')[0], expiresIn);
  }

  /**
   * Initialize a resumable upload session
   */
  async createUploadSession(
    totalSize: number,
    filename: string,
    totalChunks: number,
    options?: { storageBackend?: StorageBackendType; encrypt?: boolean },
  ): Promise<UploadSessionEntity> {
    const session = new UploadSessionEntity();
    session.id = uuidv4();
    session.filename = filename;
    session.totalSize = totalSize;
    session.uploadedBytes = 0;
    session.progress = 0;
    session.totalChunks = totalChunks;
    session.receivedChunks = [];
    session.status = UploadSessionStatus.INITIATED;
    session.storageBackend = options?.storageBackend || StorageBackendType.LOCAL;
    session.encrypt = options?.encrypt || false;
    
    // Set session expiration (24 hours by default)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    session.expiresAt = expiresAt;

    return this.sessionRepository.save(session);
  }

  /**
   * Process an individual chunk for resumable uploads
   */
  async processChunk(
    sessionId: string,
    chunkNumber: number,
    chunkBuffer: Buffer,
  ): Promise<UploadSessionEntity> {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new AppException(ErrorCodes.UPLOAD_SESSION_NOT_FOUND, 'Upload session not found');
    }

    if (session.status === UploadSessionStatus.COMPLETED) {
      throw new AppException(ErrorCodes.UPLOAD_ALREADY_COMPLETE, 'Upload is already complete');
    }

    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new AppException(ErrorCodes.UPLOAD_SESSION_EXPIRED, 'Upload session has expired');
    }

    // Validate chunk
    this.validationService.validateChunk(chunkNumber, session.totalChunks, chunkBuffer.length);

    // Store chunk (in production you'd store chunks in temporary storage)
    const tempFilename = `${sessionId}_chunk_${chunkNumber}`;
    const backend = this.storageBackendFactory.getBackend(session.storageBackend);
    await backend.upload(chunkBuffer, tempFilename, { isTemporary: true });

    // Update session progress
    if (!session.receivedChunks) session.receivedChunks = [];
    if (!session.receivedChunks.includes(chunkNumber)) {
      session.receivedChunks.push(chunkNumber);
      session.uploadedBytes += chunkBuffer.length;
      session.progress = Math.min(100, (session.uploadedBytes / session.totalSize) * 100);
      
      // Check if all chunks are received
      if (session.receivedChunks.length === session.totalChunks) {
        session.status = UploadSessionStatus.COMPLETED;
        session.progress = 100;
        // Here you would assemble all chunks and process the complete file
      } else {
        session.status = UploadSessionStatus.UPLOADING;
      }
    }

    return this.sessionRepository.save(session);
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'bin';
  }

  /**
   * Cleanup old orphaned files (run periodically)
   */
  async cleanupOrphanedFiles(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const orphanedFiles = await this.fileRepository
      .createQueryBuilder('file')
      .where('file.createdAt < :cutoff', { cutoff: cutoffDate })
      .andWhere('file.status = :status', { status: FileStatus.PENDING })
      .getMany();

    let deletedCount = 0;
    for (const file of orphanedFiles) {
      const deleted = await this.deleteFile(file.id);
      if (deleted) deletedCount++;
    }

    this.logger.log(`Cleaned up ${deletedCount} orphaned files`);
    return deletedCount;
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileId: string): Promise<UploadedFileEntity> {
    const file = await this.fileRepository.findOne({
      where: { id: fileId },
      relations: ['metadata'],
    });
    
    if (!file) {
      throw new AppException(ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    return file;
  }

  /**
   * Search files by text query
   */
  async searchFiles(query: string, limit: number = 20, offset: number = 0): Promise<UploadedFileEntity[]> {
    return this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.metadata', 'metadata')
      .where(`metadata.searchVector @@ to_tsquery(:query)`, { query: query.split(' ').join(' & ') })
      .orderBy('file.createdAt', 'DESC')
      .limit(limit)
      .offset(offset)
      .getMany();
  }
}