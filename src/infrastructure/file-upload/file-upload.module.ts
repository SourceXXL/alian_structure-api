import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";

import { UploadedFile } from "./entities/uploaded-file.entity";
import { FileThumbnail } from "./entities/file-thumbnail.entity";
import { FileScanResult } from "./entities/file-scan-result.entity";

import { LocalStorageBackend } from "./storage/local-storage.backend";
import { S3StorageBackend } from "./storage/s3-storage.backend";
import { AzureBlobStorageBackend } from "./storage/azure-blob-storage.backend";

import { FileValidationService } from "./services/file-validation.service";
import { FileScanService } from "./services/file-scan.service";
import { FileMetadataService } from "./services/file-metadata.service";
import { FileStorageService } from "./services/file-storage.service";
import { FileCleanupService } from "./services/file-cleanup.service";

import { FileUploadController } from "./file-upload.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([UploadedFile, FileThumbnail, FileScanResult]),
    ConfigModule,
  ],
  controllers: [FileUploadController],
  providers: [
    LocalStorageBackend,
    S3StorageBackend,
    AzureBlobStorageBackend,
    FileValidationService,
    FileScanService,
    FileMetadataService,
    FileStorageService,
    FileCleanupService,
  ],
  exports: [
    FileStorageService,
    FileValidationService,
    FileMetadataService,
    FileScanService,
    FileCleanupService,
    LocalStorageBackend,
    S3StorageBackend,
    AzureBlobStorageBackend,
  ],
})
export class FileUploadModule {}
