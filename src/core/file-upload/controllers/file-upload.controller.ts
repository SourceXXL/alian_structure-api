import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  Get,
  Param,
  Delete,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from '../services/file-upload.service';
import { FileStorageService } from '../services/file-storage.service';
import { UploadProgressService } from '../services/upload-progress.service';
import { StorageBackendType } from '../entities/uploaded-file.entity';
import { AppException } from '../../../common/errors/app.exception';

interface UploadRequestBody {
  storageBackend?: StorageBackendType;
  encrypt?: boolean;
  processImage?: boolean;
  generateThumbnails?: boolean;
  scanForVirus?: boolean;
  async?: boolean;
}

interface ChunkUploadBody {
  sessionId: string;
  chunkNumber: number;
  totalChunks: number;
}

@Controller('api/files')
export class FileUploadController {
  private readonly logger = new Logger(FileUploadController.name);

  constructor(
    private readonly fileUploadService: FileUploadService,
    private readonly fileStorageService: FileStorageService,
    private readonly uploadProgressService: UploadProgressService,
  ) {}

  /**
   * Upload a single file synchronously
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadRequestBody,
  ) {
    try {
      this.logger.log(`Received file upload: ${file.originalname}`);

      if (body.async) {
        const result = await this.fileUploadService.uploadFileAsync(
          file.buffer,
          file.originalname,
          {
            storageBackend: body.storageBackend,
            encrypt: body.encrypt,
            processImage: body.processImage,
            generateThumbnails: body.generateThumbnails,
            scanForVirus: body.scanForVirus,
          },
        );
        return {
          success: true,
          data: result,
        };
      }

      const result = await this.fileUploadService.uploadFileSync(
        file.buffer,
        file.originalname,
        {
          storageBackend: body.storageBackend,
          encrypt: body.encrypt,
          processImage: body.processImage,
          generateThumbnails: body.generateThumbnails,
          scanForVirus: body.scanForVirus,
        },
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error(`File upload failed: ${(error as Error).message}`, (error as Error).stack);
      
      if (error instanceof AppException) {
        throw new HttpException(
          {
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          success: false,
          error: {
            code: 'UPLOAD_FAILED',
            message: 'File upload failed',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Upload a chunk for resumable uploads
   */
  @Post('upload/chunk')
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ChunkUploadBody,
  ) {
    try {
      this.logger.log(`Received chunk ${body.chunkNumber}/${body.totalChunks} for session ${body.sessionId}`);

      const result = await this.fileUploadService.uploadChunk(
        body.sessionId,
        body.chunkNumber,
        body.totalChunks,
        file.buffer,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Chunk upload failed: ${(error as Error).message}`);
      
      if (error instanceof AppException) {
        throw new HttpException(
          {
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          success: false,
          error: {
            code: 'CHUNK_UPLOAD_FAILED',
            message: 'Chunk upload failed',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Initialize a new resumable upload session
   */
  @Post('upload/init')
  async initializeUpload(
    @Body() body: {
      filename: string;
      totalSize: number;
      totalChunks: number;
      storageBackend?: StorageBackendType;
      encrypt?: boolean;
    },
  ) {
    try {
      const session = await this.fileStorageService.createUploadSession(
        body.totalSize,
        body.filename,
        body.totalChunks,
        {
          storageBackend: body.storageBackend,
          encrypt: body.encrypt,
        },
      );

      return {
        success: true,
        data: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to initialize upload: ${(error as Error).message}`);
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'INITIALIZATION_FAILED',
            message: 'Failed to initialize upload session',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get the progress/status of an upload session
   */
  @Get('status/:sessionId')
  async getUploadStatus(@Param('sessionId') sessionId: string) {
    try {
      const progress = await this.uploadProgressService.getUploadProgress(sessionId);
      
      if (!progress) {
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Upload session not found',
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      
      return {
        success: true,
        data: progress,
      };
    } catch (error) {
      this.logger.error(`Failed to get upload status for session ${sessionId}: ${(error as Error).message}`);
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'STATUS_CHECK_FAILED',
            message: 'Failed to retrieve upload status',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cancel an in-progress upload
   */
  @Delete('upload/:sessionId')
  async cancelUpload(@Param('sessionId') sessionId: string) {
    try {
      const cancelled = await this.fileUploadService.cancelUpload(sessionId);
      return {
        success: cancelled,
        message: cancelled ? 'Upload cancelled successfully' : 'Failed to cancel upload',
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'CANCELLATION_FAILED',
            message: 'Failed to cancel upload',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Retry a failed upload
   */
  @Post('retry/:sessionId')
  async retryUpload(@Param('sessionId') sessionId: string) {
    try {
      const result = await this.fileUploadService.retryUpload(sessionId);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'RETRY_FAILED',
            message: 'Failed to retry upload',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Search files by text query
   */
  @Get('search')
  async searchFiles(
    @Query('q') query: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    try {
      const files = await this.fileStorageService.searchFiles(
        query,
        limit || 20,
        offset || 0,
      );

      // Return only public metadata
      const publicFiles = files.map(file => ({
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
        status: file.status,
      }));

      return {
        success: true,
        data: publicFiles,
        count: publicFiles.length,
      };
    } catch (error) {
      this.logger.error(`Search failed: ${(error as Error).message}`);
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'SEARCH_FAILED',
            message: 'Failed to search files',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get upload statistics (admin only)
   */
  @Get('stats')
  async getUploadStats() {
    try {
      const stats = await this.fileUploadService.getUploadStats();
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'STATS_RETRIEVAL_FAILED',
            message: 'Failed to retrieve upload statistics',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}