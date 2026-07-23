import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MoreThan } from 'typeorm';
import { FileStorageService } from './file-storage.service';
import { VirusScannerService } from './virus-scanner.service';
import { FILE_UPLOAD_QUEUE, PROCESS_UPLOAD_JOB, PROCESS_ASSEMBLED_FILE_JOB, VIRUS_SCAN_JOB, IMAGE_PROCESSING_JOB, METADATA_EXTRACTION_JOB, CLEANUP_JOB } from '../constants/queue.constants';
import { StorageBackendType } from '../entities/uploaded-file.entity';

interface UploadOptions {
  storageBackend?: StorageBackendType;
  encrypt?: boolean;
  processImage?: boolean;
  generateThumbnails?: boolean;
  scanForVirus?: boolean;
}

interface UploadResult {
  fileId: string;
  status: string;
  message: string;
  queuePosition?: number;
}

@Injectable()
export class FileUploadService implements OnModuleInit {
  private readonly logger = new Logger(FileUploadService.name);

  constructor(
    private readonly fileStorageService: FileStorageService,
  @InjectQueue(FILE_UPLOAD_QUEUE) private readonly uploadQueue: Queue,
  private readonly schedulerRegistry: SchedulerRegistry,
  private readonly virusScanner: VirusScannerService,
) {}

  onModuleInit() {
    // Schedule periodic cleanup job (runs daily at 2 AM)
    const cleanupJob = new CronJob('0 0 2 * * *', async () => {
      this.logger.log('Running daily orphaned file cleanup');
      try {
        const deleted = await this.fileStorageService.cleanupOrphanedFiles(30);
        this.logger.log(`Cleaned up ${deleted} orphaned files');
      } catch (error) {
        this.logger.error('Cleanup job failed:', error);
      }
    });
    
    this.schedulerRegistry.addCronJob('daily-file-cleanup', cleanupJob);
    cleanupJob.start();
    this.logger.log('Daily file cleanup job scheduled');
  }

  /**
   * Synchronous file upload that waits for all processing to complete
   */
  async uploadFileSync(
    buffer: Buffer,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    this.logger.log(`Starting synchronous upload for ${filename}`);
    
    try {
      const file = await this.fileStorageService.uploadFile(buffer, filename, {
        storageBackend: options?.storageBackend,
        encrypt: options?.encrypt,
        processImage: options?.processImage,
        generateThumbnails: options?.generateThumbnails,
      });

      return {
        fileId: file.id,
        status: 'completed',
        message: 'File uploaded and processed successfully',
      };
    } catch (error) {
      this.logger.error(`Synchronous upload failed:', error);
      throw error;
    }
  }

  /**
   * Asynchronous upload that queues background processing
   */
  async uploadFileAsync(
    buffer: Buffer,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    this.logger.log(`Starting asynchronous upload for ${filename}`);
    
    // First, perform basic validation before queuing
    const validationResult = await this.fileStorageService['validationService'].validateFile(buffer, filename);
    if (!validationResult.valid) {
      throw new Error(`File validation failed: ${validationResult.errors.join(', ')}`);
    }

    // Create upload session for tracking
    const session = await this.fileStorageService.createUploadSession(
      buffer.length,
      filename,
      1, // Single chunk for async upload
      {
        storageBackend: options?.storageBackend,
        encrypt: options?.encrypt,
      },
    );

    // Queue the file for background processing
    const job = await this.uploadQueue.add(PROCESS_UPLOAD_JOB, {
      sessionId: session.id,
      filename,
      buffer: Array.from(buffer), // Convert buffer to array for serialization
      options: {
        ...options,
        scanForVirus: options?.scanForVirus !== false && this.virusScanner.isEnabled(),
      },
    });

    this.logger.log(`File ${filename} queued for processing with job ID ${job.id}`);

    return {
      fileId: session.id,
      status: 'queued',
      message: 'File has been queued for processing',
      queuePosition: await this.uploadQueue.getJobCounts().then(counts => counts.waiting + 1),
    };
  }

  /**
   * Get the status of an asynchronous upload
   */
  async getUploadStatus(sessionId: string): Promise<{
    status: string;
    progress: number;
    fileId?: string;
    errors?: string[];
  }> {
    try {
      const session = await this.fileStorageService['sessionRepository'].findOne({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Upload session not found');
      }

      // Also check queue job status
      const jobs = await this.uploadQueue.getJobs(['active', 'waiting', 'completed', 'failed'], 0, 100);
      const job = jobs.find(j => j.data.sessionId === sessionId);

      let queueStatus = session.status;
      let jobErrors: string[] | undefined;

      if (job) {
        if (await job.isCompleted()) {
          queueStatus = 'completed';
          const result = await job.returnvalue;
          if (result?.fileId) {
            return {
              status: 'completed',
              progress: 100,
              fileId: result.fileId,
            };
          }
        } else if (await job.isFailed()) {
          queueStatus = 'failed';
          jobErrors = [(await job.failedReason)];
        } else if (await job.isActive()) {
          queueStatus = 'processing';
        }
      }

      return {
        status: queueStatus,
        progress: session.progress || 0,
        errors: jobErrors,
      };
    } catch (error) {
      this.logger.error(`Failed to get upload status for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Handle chunked uploads for large files
   */
  async uploadChunk(
    sessionId: string,
    chunkNumber: number,
    totalChunks: number,
    chunkBuffer: Buffer,
  ): Promise<{
    received: number;
    progress: number;
    completed: boolean;
  }> {
    this.logger.log(`Processing chunk ${chunkNumber}/${totalChunks} for session ${sessionId}`);
    
    const session = await this.fileStorageService.processChunk(sessionId, chunkNumber, chunkBuffer);
    
    const isComplete = session.receivedChunks?.length === totalChunks;
    
    // If all chunks are received, start processing the complete file
    if (isComplete) {
      this.logger.log(`All chunks received for session ${sessionId}, starting final processing`);
      // Queue the complete file for processing
      await this.assembleAndProcessCompleteFile(sessionId);
    }

    return {
      received: session.receivedChunks?.length || 0,
      progress: session.progress || 0,
      completed: isComplete,
    };
  }

  /**
   * Assemble chunks and process the complete file
   */
  private async assembleAndProcessCompleteFile(sessionId: string): Promise<void> {
    const session = await this.fileStorageService['sessionRepository'].findOne({
      where: { id: sessionId },
    });
    
    if (!session) {
      this.logger.error(`Cannot assemble file: session ${sessionId} not found`);
      return;
    }

    try {
      this.logger.log(`Starting assembly of chunks for session ${sessionId}`);
      
      // 1. Get the storage backend
      const backend = this.fileStorageService['storageBackendFactory'].getBackend(session.storageBackend);
      
      // 2. Sort chunks to ensure correct order
      const sortedChunks = [...(session.receivedChunks || [])].sort((a, b) => a - b);
      this.logger.log(`Processing ${sortedChunks.length} chunks in order: ${sortedChunks.join(', ')}`);
      
      // 3. Download all chunk files and concatenate
      const completeBufferChunks: Buffer[] = [];
      for (const chunkNumber of sortedChunks) {
        const tempFilename = `${sessionId}_chunk_${chunkNumber}`;
        this.logger.log(`Downloading chunk ${chunkNumber}: ${tempFilename}`);
        
        try {
          const stream = await backend.download(tempFilename);
          const chunkData: Buffer[] = [];
          for await (const chunk of stream) {
            chunkData.push(Buffer.from(chunk));
          }
          completeBufferChunks.push(Buffer.concat(chunkData));
          
          // 4. Delete the temporary chunk file after successful download
          await backend.delete(tempFilename);
          this.logger.log(`Deleted temporary chunk file: ${tempFilename}`);
        } catch (error) {
          this.logger.error(`Failed to process chunk ${chunkNumber}:`, error);
          throw error;
        }
      }
      
      // 5. Concatenate all chunks into the complete file buffer
      const completeBuffer = Buffer.concat(completeBufferChunks);
      this.logger.log(`Successfully assembled complete file. Total size: ${completeBuffer.length} bytes`);
      
      // 6. Update session status to processing
      session.status = 'processing';
      await this.fileStorageService['sessionRepository'].save(session);
      
      // 7. Pass the complete buffer to the standard upload pipeline
      const file = await this.fileStorageService.uploadFile(completeBuffer, session.filename, {
        storageBackend: session.storageBackend,
        encrypt: session.encrypt,
        processImage: true,
        generateThumbnails: true,
      });
      
      // 8. Update session status to completed and link to the processed file
      session.status = 'completed';
      session.processedFileId = file.id;
      session.progress = 100;
      await this.fileStorageService['sessionRepository'].save(session);
      
      this.logger.log(`Successfully processed assembled file for session ${sessionId}. File ID: ${file.id}`);
      
    } catch (error) {
      this.logger.error(`Failed to assemble and process file for session ${sessionId}:`, error);
      
      // Update session status to failed
      session.status = 'failed';
      session.errorMessage = (error as Error).message;
      await this.fileStorageService['sessionRepository'].save(session);
      
      // Clean up any remaining temporary files
      try {
        const backend = this.fileStorageService['storageBackendFactory'].getBackend(session.storageBackend);
        for (const chunkNumber of session.receivedChunks || []) {
          const tempFilename = `${sessionId}_chunk_${chunkNumber}`;
          await backend.delete(tempFilename).catch(() => {});
        }
      } catch (cleanupError) {
        this.logger.error(`Failed to clean up temporary files after assembly failure:`, cleanupError);
      }
    }
  }

  /**
   * Cancel an in-progress upload
   */
  async cancelUpload(sessionId: string): Promise<boolean> {
    this.logger.log(`Cancelling upload session ${sessionId}`);
    
    try {
      const session = await this.fileStorageService['sessionRepository'].findOne({
        where: { id: sessionId },
      });

      if (!session) {
        return false;
      }

      // Delete any temporary chunk files
      const backend = this.fileStorageService['storageBackendFactory'].getBackend(session.storageBackend);
      for (const chunkNumber of session.receivedChunks || []) {
        const tempFilename = `${sessionId}_chunk_${chunkNumber}`;
        await backend.delete(tempFilename.split('.')[0]);
      }

      // Update session status
      session.status = 'cancelled';
      await this.fileStorageService['sessionRepository'].save(session);

      // Remove any queued jobs
      const jobs = await this.uploadQueue.getJobs(['waiting', 'active'], 0, 100);
      for (const job of jobs) {
        if (job.data.sessionId === sessionId) {
          await job.remove();
        }
      }

      this.logger.log(`Upload session ${sessionId} cancelled successfully');
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel upload ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Retry a failed upload
   */
  async retryUpload(sessionId: string): Promise<UploadResult> {
    this.logger.log(`Retrying failed upload session ${sessionId}`);
    
    const session = await this.fileStorageService['sessionRepository'].findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Upload session not found');
    }

    if (session.status !== 'failed') {
      throw new Error('Can only retry failed uploads');
    }

    // Reset session
    session.status = 'initiated';
    await this.fileStorageService['sessionRepository'].save(session);

    // Re-queue for processing
    const job = await this.uploadQueue.add(PROCESS_UPLOAD_JOB, {
      sessionId,
      filename: session.filename,
      storageBackend: session.storageBackend,
      encrypt: session.encrypt,
    });

    return {
      fileId: sessionId,
      status: 'queued',
      message: 'Upload has been requeued',
      queuePosition: await this.uploadQueue.getJobCounts().then(counts => counts.waiting + 1),
    };
  }

  /**
   * Get upload statistics
   */
  async getUploadStats(): Promise<{
    totalToday: number;
    processing: number;
    completed: number;
    failed: number;
    storageUsage: Record<StorageBackendType, number>;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [fileStats, sessionStats] = await Promise.all([
      this.fileStorageService['fileRepository'].count({
        where: { createdAt: MoreThan(today) },
      }),
      this.fileStorageService['sessionRepository'].createQueryBuilder('session')
        .select('status, count(*) as count')
        .groupBy('status')
        .getRawMany(),
    ]);

    const storageStats = await this.fileStorageService['fileRepository'].createQueryBuilder('file')
      .select('storageBackend, count(*) as count')
      .groupBy('storageBackend')
      .getRawMany();

    const storageUsage: Record<StorageBackendType, number> = {
      [StorageBackendType.LOCAL]: 0,
      [StorageBackendType.S3]: 0,
      [StorageBackendType.AZURE_BLOB]: 0,
    };

    for (const stat of storageStats) {
      storageUsage[stat.storageBackend as StorageBackendType] = parseInt(stat.count);
    }

    const statusMap: Record<string, number> = {};
    for (const stat of sessionStats) {
      statusMap[stat.status] = parseInt(stat.count);
    }

    return {
      totalToday: fileStats,
      processing: statusMap['uploading'] || 0,
      completed: statusMap['completed'] || 0,
      failed: statusMap['failed'] || 0,
      storageUsage,
    };
  }
}