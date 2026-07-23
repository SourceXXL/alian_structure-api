import {
  Controller,
  Get,
  Param,
  Res,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { FileStorageService } from '../services/file-storage.service';
import { AppException } from '../../../common/errors/app.exception';

@Controller('api/files')
export class FileDownloadController {
  private readonly logger = new Logger(FileDownloadController.name);

  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Download a file directly
   */
  @Get('download/:fileId')
  async downloadFile(
    @Param('fileId') fileId: string,
    @Query('inline') inline: string = 'false',
    @Query('token') token?: string,
    @Res() res: Response,
  ) {
    try {
      this.logger.log(`Download request for file: ${fileId}`);

      // Validate JWT token if present (for signed URLs)
      if (token) {
        try {
          const payload = this.jwtService.verify(token);
          // Verify the token is for the requested file
          if (payload.sub !== fileId) {
            throw new HttpException('Invalid token for this file', HttpStatus.FORBIDDEN);
          }
          this.logger.log(`Validated signed URL token for file ${fileId}, expires at ${new Date(payload.exp * 1000)}`);
        } catch (jwtError) {
          this.logger.error(`JWT validation failed for file ${fileId}: ${(jwtError as Error).message}`);
          throw new HttpException('Invalid or expired download token', HttpStatus.UNAUTHORIZED);
        }
      }

      const { buffer, mimeType, filename } = await this.fileStorageService.downloadFile(fileId);
      
      // Set headers
      res.setHeader('Content-Type', mimeType);
      res.setHeader(
        'Content-Disposition',
        inline === 'true' 
          ? `inline; filename="${encodeURIComponent(filename)}"`
          : `attachment; filename="${encodeURIComponent(filename)}"`
      );
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour
      
      // Send the file
      res.send(buffer);
    } catch (error) {
      this.logger.error(`Download failed for file ${fileId}: ${(error as Error).message}`);
      
      if (error instanceof AppException) {
        if (error.code === 'FILE_NOT_FOUND') {
          throw new HttpException('File not found', HttpStatus.NOT_FOUND);
        }
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'Failed to download file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a signed download URL (for temporary access)
   */
  @Get('signed/:fileId')
  async getSignedUrl(
    @Param('fileId') fileId: string,
    @Query('expiresIn') expiresIn?: number,
  ) {
    try {
      const signedUrl = await this.fileStorageService.getSignedUrl(fileId, expiresIn);
      
      return {
        success: true,
        data: {
          url: signedUrl,
          expiresAt: new Date(Date.now() + (expiresIn || 3600) * 1000),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for ${fileId}: ${(error as Error).message}`);
      
      if (error instanceof AppException) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        'Failed to generate download URL',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Stream a file (for large files)
   */
  @Get('stream/:fileId')
  async streamFile(
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    try {
      // First get file metadata to set headers
      const fileMetadata = await this.fileStorageService.getFileMetadata(fileId);
      
      res.setHeader('Content-Type', fileMetadata.mimeType);
      res.setHeader('Content-Length', fileMetadata.size);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      
      // Get the storage backend to stream the file directly
      const backend = this.fileStorageService['storageBackendFactory'].getBackend(fileMetadata.storageBackend);
      const stream = await backend.download(fileMetadata.storedFilename.split('.')[0]);
      
      // Pipe the stream to the response
      stream.pipe(res);
      
      stream.on('error', (error) => {
        this.logger.error(`Streaming error for ${fileId}:`, error);
        if (!res.headersSent) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Streaming failed');
        }
      });
    } catch (error) {
      this.logger.error(`Stream failed for ${fileId}: ${(error as Error).message}`);
      
      if (error instanceof AppException) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        'Failed to stream file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get only file metadata without downloading the content
   */
  @Get('metadata/:fileId')
  async getFileMetadata(@Param('fileId') fileId: string) {
    try {
      const file = await this.fileStorageService.getFileMetadata(fileId);
      
      // Return only public, non-sensitive metadata
      const publicMetadata = {
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        status: file.status,
        storageBackend: file.storageBackend,
        encrypted: file.encrypted,
        virusScanned: file.virusScanned,
        downloads: file.downloadCount || 0,
        // Include basic metadata if available
        metadata: file.metadata ? {
          title: file.metadata.title,
          author: file.metadata.author,
          keywords: file.metadata.keywords,
        } : null,
      };

      return {
        success: true,
        data: publicMetadata,
      };
    } catch (error) {
      this.logger.error(`Failed to retrieve metadata for ${fileId}: ${(error as Error).message}`);
      
      if (error instanceof AppException) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        'Failed to retrieve file metadata',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Download a thumbnail version of an image
   */
  @Get('thumbnail/:fileId')
  async downloadThumbnail(
    @Param('fileId') fileId: string,
    @Query('size') size: string = '320x240',
    @Res() res: Response,
  ) {
    try {
      // In a production implementation, you would:
      // 1. Verify the file is an image
      // 2. Retrieve the pre-generated thumbnail from storage
      // 3. Stream it to the client
      
      // For this implementation, we'll fetch the full image and let the client handle it
      // In production, thumbnails are pre-generated during upload
      const file = await this.fileStorageService.getFileMetadata(fileId);
      
      if (!file.mimeType.startsWith('image/')) {
        throw new AppException('NOT_AN_IMAGE', 'Thumbnails are only available for image files');
      }

      // Get the thumbnail from storage (would exist in production)
      const thumbnailFilename = `${file.storedFilename.split('.')[0]}_${size}.webp`;
      const backend = this.fileStorageService['storageBackendFactory'].getBackend(file.storageBackend);
      
      try {
        const stream = await backend.download(thumbnailFilename.split('.')[0]);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache thumbnails for 24h
        stream.pipe(res);
      } catch {
        // If thumbnail doesn't exist, fall back to full image
        this.logger.warn(`Thumbnail ${size} not found for ${fileId}, serving full image`);
        const { buffer, mimeType } = await this.fileStorageService.downloadFile(fileId);
        res.setHeader('Content-Type', mimeType);
        res.send(buffer);
      }
    } catch (error) {
      this.logger.error(`Thumbnail download failed for ${fileId}: ${(error as Error).message}`);
      
      if (error instanceof AppException) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'Failed to download thumbnail',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}