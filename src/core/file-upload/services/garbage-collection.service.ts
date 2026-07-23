import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { UploadSessionEntity } from '../entities/upload-session.entity';
import { UploadedFileEntity } from '../entities/uploaded-file.entity';
import { FileStorageService } from './file-storage.service';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class GarbageCollectionService {
  private readonly logger = new Logger(GarbageCollectionService.name);
  private readonly tempDirectory: string;

  constructor(
    @InjectRepository(UploadSessionEntity)
    private readonly uploadSessionRepository: Repository<UploadSessionEntity>,
    @InjectRepository(UploadedFileEntity)
    private readonly uploadedFileRepository: Repository<UploadedFileEntity>,
    private readonly fileStorageService: FileStorageService,
  ) {
    this.tempDirectory = path.join(process.cwd(), 'uploads', 'temp');
  }

  /**
   * Periodic cleanup of orphaned files and incomplete upload sessions
   * Runs every hour to clean up:
   * 1. Stale upload sessions (incomplete for more than 24 hours)
   * 2. Orphaned temporary files not referenced by any active session
   * 3. Files that were marked for deletion but not yet removed
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runGarbageCollection() {
    this.logger.log('Starting garbage collection process...');
    
    try {
      await this.cleanupStaleUploadSessions();
      await this.cleanupOrphanedTempFiles();
      await this.cleanupMarkedForDeletionFiles();
      
      this.logger.log('Garbage collection process completed successfully');
    } catch (error) {
      this.logger.error(`Garbage collection failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  /**
   * Clean up upload sessions that have been incomplete for more than 24 hours
   */
  private async cleanupStaleUploadSessions() {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const staleSessions = await this.uploadSessionRepository.find({
      where: {
        createdAt: MoreThan(twentyFourHoursAgo),
        status: 'PENDING' // Only cleanup pending/incomplete sessions
      }
    });

    this.logger.log(`Found ${staleSessions.length} stale upload sessions to clean up`);

    for (const session of staleSessions) {
      try {
        // Delete all temporary chunk files associated with this session
        const sessionTempFiles = await fs.readdir(this.tempDirectory);
        const sessionFiles = sessionTempFiles.filter(file => file.startsWith(session.id));
        
        for (const file of sessionFiles) {
          const filePath = path.join(this.tempDirectory, file);
          await fs.unlink(filePath);
          this.logger.log(`Deleted stale chunk file: ${filePath}`);
        }

        // Mark session as cancelled
        session.status = 'CANCELLED';
        await this.uploadSessionRepository.save(session);
        
        this.logger.log(`Marked stale upload session ${session.id} as cancelled`);
      } catch (error) {
        this.logger.error(`Failed to clean up stale session ${session.id}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Clean up temporary files that are not referenced by any active upload session
   */
  private async cleanupOrphanedTempFiles() {
    try {
      // Ensure temp directory exists
      await fs.access(this.tempDirectory).catch(() => fs.mkdir(this.tempDirectory, { recursive: true }));
      
      const tempFiles = await fs.readdir(this.tempDirectory);
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds

      for (const file of tempFiles) {
        const filePath = path.join(this.tempDirectory, file);
        const stats = await fs.stat(filePath);
        
        if (stats.birthtimeMs < sevenDaysAgo) {
          // Check if this file is referenced by any active upload session
          const sessionExists = await this.uploadSessionRepository.findOne({
            where: { id: file.split('_chunk_')[0] }
          });

          if (!sessionExists) {
            await fs.unlink(filePath);
            this.logger.log(`Deleted orphaned temp file: ${filePath}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup orphaned temp files: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up files that were marked for deletion but not yet removed from storage
   */
  private async cleanupMarkedForDeletionFiles() {
    const filesToDelete = await this.uploadedFileRepository.find({
      where: {
        markedForDeletion: true,
        deletedAt: MoreThan(new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))) // Files marked for deletion in last 7 days
      }
    });

    this.logger.log(`Found ${filesToDelete.length} files marked for deletion`);

    for (const file of filesToDelete) {
      try {
        await this.fileStorageService.deleteFile(file.id);
        await this.uploadedFileRepository.remove(file);
        this.logger.log(`Permanently deleted file ${file.id} from storage`);
      } catch (error) {
        this.logger.error(`Failed to delete file ${file.id}: ${(error as Error).message}`);
      }
    }
  }
}