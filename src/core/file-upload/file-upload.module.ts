import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { FileUploadService } from './services/file-upload.service';
import { FileStorageService } from './services/file-storage.service';
import { FileValidationService } from './services/file-validation.service';
import { VirusScannerService } from './services/virus-scanner.service';
import { ImageProcessingService } from './services/image-processing.service';
import { MetadataExtractorService } from './services/metadata-extractor.service';
import { EncryptionService } from './services/encryption.service';
import { GarbageCollectionService } from './services/garbage-collection.service';
import { UrlSigningService } from './services/url-signing.service';
import { UploadProgressService } from './services/upload-progress.service';
import { FileUploadController } from './controllers/file-upload.controller';
import { FileDownloadController } from './controllers/file-download.controller';
import { LocalStorageBackend } from './storage-backends/local-storage.backend';
import { S3StorageBackend } from './storage-backends/s3-storage.backend';
import { AzureBlobStorageBackend } from './storage-backends/azure-blob-storage.backend';
import { StorageBackendFactory } from './storage-backends/storage-backend.factory';
import { UploadedFileEntity } from './entities/uploaded-file.entity';
import { FileMetadataEntity } from './entities/file-metadata.entity';
import { UploadSessionEntity } from './entities/upload-session.entity';
import { FILE_UPLOAD_QUEUE } from './constants/queue.constants';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-jwt-secret-change-in-production',
      signOptions: {
        expiresIn: '1h',
      },
    }),
    TypeOrmModule.forFeature([
      UploadedFileEntity,
      FileMetadataEntity,
      UploadSessionEntity,
    ]),
    MulterModule.registerAsync({
      useFactory: () => ({
        limits: {
          fileSize: 100 * 1024 * 1024, // 100MB default
        },
      }),
    }),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: FILE_UPLOAD_QUEUE,
    }),
  ],
  controllers: [FileUploadController, FileDownloadController],
  providers: [
    FileUploadService,
    FileStorageService,
    FileValidationService,
    VirusScannerService,
    ImageProcessingService,
    MetadataExtractorService,
    EncryptionService,
    GarbageCollectionService,
    UrlSigningService,
    UploadProgressService,
    LocalStorageBackend,
    S3StorageBackend,
    AzureBlobStorageBackend,
    StorageBackendFactory,
  ],
  exports: [FileUploadService, FileStorageService],
})
export class FileUploadModule {}