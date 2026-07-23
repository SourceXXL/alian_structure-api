import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadSessionEntity } from '../entities/upload-session.entity';
import { UploadSessionStatus } from '../entities/upload-session.entity';

export interface UploadProgress {
  sessionId: string;
  fileId: string;
  totalSize: number;
  uploadedSize: number;
  chunksReceived: number;
  totalChunks: number;
  percentage: number;
  status: UploadSessionStatus;
  lastChunkReceivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UploadProgressService {
  private readonly logger = new Logger(UploadProgressService.name);

  constructor(
    @InjectRepository(UploadSessionEntity)
    private readonly uploadSessionRepository: Repository<UploadSessionEntity>,
  ) {}

  /**
   * Get the current progress of an upload session
   * @param sessionId - The ID of the upload session
   * @returns Detailed upload progress information
   */
  async getUploadProgress(sessionId: string): Promise<UploadProgress | null> {
    const session = await this.uploadSessionRepository.findOne({
      where: { id: sessionId }
    });

    if (!session) {
      this.logger.warn(`Upload session ${sessionId} not found`);
      return null;
    }

    const progress = this.calculateProgress(session);
    this.logger.debug(`Retrieved progress for session ${sessionId}: ${progress.percentage}% complete`);
    
    return progress;
  }

  /**
   * Update progress when a new chunk is received
   * @param sessionId - The ID of the upload session
   * @param chunkIndex - The index of the chunk that was just received
   * @param chunkSize - The size of the chunk that was just received
   */
  async updateChunkProgress(sessionId: string, chunkIndex: number, chunkSize: number): Promise<UploadProgress | null> {
    const session = await this.uploadSessionRepository.findOne({
      where: { id: sessionId }
    });

    if (!session) {
      this.logger.error(`Cannot update progress: session ${sessionId} not found`);
      return null;
    }

    // Add this chunk to the received chunks list if not already present
    if (!session.receivedChunks.includes(chunkIndex)) {
      session.receivedChunks.push(chunkIndex);
      session.uploadedSize += chunkSize;
      session.lastChunkReceivedAt = new Date();
      
      await this.uploadSessionRepository.save(session);
      this.logger.debug(`Updated session ${sessionId}: chunk ${chunkIndex} received, total uploaded: ${session.uploadedSize} bytes`);
    }

    return this.calculateProgress(session);
  }

  /**
   * Mark an upload session as processing (all chunks received)
   * @param sessionId - The ID of the upload session
   */
  async markAsProcessing(sessionId: string): Promise<boolean> {
    try {
      const session = await this.uploadSessionRepository.findOne({
        where: { id: sessionId }
      });

      if (!session) {
        return false;
      }

      session.status = UploadSessionStatus.PROCESSING;
      await this.uploadSessionRepository.save(session);
      
      this.logger.log(`Upload session ${sessionId} marked as processing`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to mark session ${sessionId} as processing: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Mark an upload session as completed
   * @param sessionId - The ID of the upload session
   * @param processedFileId - The ID of the final processed file
   */
  async markAsCompleted(sessionId: string, processedFileId: string): Promise<boolean> {
    try {
      const session = await this.uploadSessionRepository.findOne({
        where: { id: sessionId }
      });

      if (!session) {
        return false;
      }

      session.status = UploadSessionStatus.COMPLETED;
      session.processedFileId = processedFileId;
      await this.uploadSessionRepository.save(session);
      
      this.logger.log(`Upload session ${sessionId} marked as completed, processed file ID: ${processedFileId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to mark session ${sessionId} as completed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Mark an upload session as failed
   * @param sessionId - The ID of the upload session
   * @param errorMessage - Optional error message explaining the failure
   */
  async markAsFailed(sessionId: string, errorMessage?: string): Promise<boolean> {
    try {
      const session = await this.uploadSessionRepository.findOne({
        where: { id: sessionId }
      });

      if (!session) {
        return false;
      }

      session.status = UploadSessionStatus.FAILED;
      session.errorMessage = errorMessage || 'Unknown error occurred during upload';
      await this.uploadSessionRepository.save(session);
      
      this.logger.error(`Upload session ${sessionId} marked as failed: ${session.errorMessage}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to mark session ${sessionId} as failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Get all active upload sessions for a user
   * @param userId - The ID of the user to get sessions for
   */
  async getActiveSessionsForUser(userId: string): Promise<UploadProgress[]> {
    const sessions = await this.uploadSessionRepository.find({
      where: {
        uploadedBy: userId,
        status: UploadSessionStatus.PENDING
      },
      order: {
        createdAt: 'DESC'
      }
    });

    return sessions.map(session => this.calculateProgress(session));
  }

  /**
   * Calculate progress metrics from an upload session
   */
  private calculateProgress(session: UploadSessionEntity): UploadProgress {
    const percentage = session.totalSize > 0 
      ? Math.round((session.uploadedSize / session.totalSize) * 100) 
      : 0;

    return {
      sessionId: session.id,
      fileId: session.fileId,
      totalSize: session.totalSize,
      uploadedSize: session.uploadedSize,
      chunksReceived: session.receivedChunks.length,
      totalChunks: session.totalChunks,
      percentage,
      status: session.status,
      lastChunkReceivedAt: session.lastChunkReceivedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Check if all chunks have been received for an upload session
   * @param sessionId - The ID of the upload session
   */
  async isUploadComplete(sessionId: string): Promise<boolean> {
    const session = await this.uploadSessionRepository.findOne({
      where: { id: sessionId }
    });

    if (!session) {
      return false;
    }

    const isComplete = session.receivedChunks.length === session.totalChunks;
    
    if (isComplete) {
      this.logger.log(`All chunks received for session ${sessionId}`);
    }

    return isComplete;
  }
}