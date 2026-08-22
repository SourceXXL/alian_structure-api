import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThan } from "typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import {
  UploadedFile,
  FileStatus,
} from "../entities/uploaded-file.entity";
import { FileThumbnail } from "../entities/file-thumbnail.entity";
import { StorageBackend } from "../storage/storage-backend.interface";
import { LocalStorageBackend } from "../storage/local-storage.backend";
import { S3StorageBackend } from "../storage/s3-storage.backend";
import { AzureBlobStorageBackend } from "../storage/azure-blob-storage.backend";
import { FileStorageBackend } from "../entities/uploaded-file.entity";
import { FileCleanupDto } from "../dto/file-upload.dto";

export interface CleanupResult {
  filesScanned: number;
  filesDeleted: number;
  thumbnailsDeleted: number;
  storageFreed: number;
  errors: string[];
}

@Injectable()
export class FileCleanupService {
  private readonly logger = new Logger(FileCleanupService.name);
  private readonly cleanupEnabled: boolean;
  private readonly orphanRetentionDays: number;
  private readonly expiredFileRetentionDays: number;

  private backends: Map<FileStorageBackend, StorageBackend>;

  constructor(
    @InjectRepository(UploadedFile)
    private readonly fileRepo: Repository<UploadedFile>,
    @InjectRepository(FileThumbnail)
    private readonly thumbnailRepo: Repository<FileThumbnail>,
    private readonly configService: ConfigService,
    private readonly localStorage: LocalStorageBackend,
    private readonly s3Storage: S3StorageBackend,
    private readonly azureStorage: AzureBlobStorageBackend,
  ) {
    this.cleanupEnabled =
      this.configService.get<boolean>("FILE_CLEANUP_ENABLED") !== false;
    this.orphanRetentionDays =
      this.configService.get<number>("FILE_ORPHAN_RETENTION_DAYS") || 7;
    this.expiredFileRetentionDays =
      this.configService.get<number>("FILE_EXPIRED_RETENTION_DAYS") || 1;

    this.backends = new Map<FileStorageBackend, StorageBackend>([
      [FileStorageBackend.LOCAL, this.localStorage],
      [FileStorageBackend.S3, this.s3Storage],
      [FileStorageBackend.AZURE_BLOB, this.azureStorage],
    ]);
  }

  /**
   * Run cleanup every day at 2 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledCleanup(): Promise<CleanupResult> {
    if (!this.cleanupEnabled) {
      this.logger.debug("File cleanup is disabled, skipping scheduled run");
      return {
        filesScanned: 0,
        filesDeleted: 0,
        thumbnailsDeleted: 0,
        storageFreed: 0,
        errors: [],
      };
    }

    this.logger.log("Starting scheduled file cleanup");
    const result = await this.cleanup({
      olderThanSeconds: this.orphanRetentionDays * 86400,
    });
    this.logger.log(
      `Scheduled cleanup completed: ${result.filesDeleted} files, ${result.thumbnailsDeleted} thumbnails, ${result.storageFreed} bytes freed`,
    );
    return result;
  }

  async cleanup(dto: FileCleanupDto = {}): Promise<CleanupResult> {
    const result: CleanupResult = {
      filesScanned: 0,
      filesDeleted: 0,
      thumbnailsDeleted: 0,
      storageFreed: 0,
      errors: [],
    };

    try {
      // 1. Clean orphaned files
      const orphanCutoff = new Date(
        Date.now() - (dto.olderThanSeconds || this.orphanRetentionDays * 86400) * 1000,
      );

      const orphanQuery = this.fileRepo.createQueryBuilder("file");
      orphanQuery.where("file.isOrphaned = :isOrphaned", { isOrphaned: true });
      orphanQuery.andWhere("file.createdAt < :cutoff", { cutoff: orphanCutoff });
      if (dto.userId) {
        orphanQuery.andWhere("file.userId = :userId", { userId: dto.userId });
      }

      const orphanedFiles = await orphanQuery.getMany();
      result.filesScanned += orphanedFiles.length;

      for (const file of orphanedFiles) {
        if (dto.dryRun) {
          result.filesDeleted++;
          result.storageFreed += file.size;
          continue;
        }
        try {
          await this.deleteFileAndThumbnails(file);
          result.filesDeleted++;
          result.storageFreed += file.size;
        } catch (error) {
          result.errors.push(
            `Failed to delete orphaned file ${file.id}: ${error.message}`,
          );
        }
      }

      // 2. Clean expired files
      const expiredFiles = await this.fileRepo
        .createQueryBuilder("file")
        .where("file.expiresAt IS NOT NULL")
        .andWhere("file.expiresAt < :now", { now: new Date() })
        .andWhere("file.isOrphaned = :isOrphaned", { isOrphaned: false })
        .getMany();

      result.filesScanned += expiredFiles.length;

      for (const file of expiredFiles) {
        if (dto.dryRun) {
          result.filesDeleted++;
          result.storageFreed += file.size;
          continue;
        }
        try {
          await this.deleteFileAndThumbnails(file);
          result.filesDeleted++;
          result.storageFreed += file.size;
        } catch (error) {
          result.errors.push(
            `Failed to delete expired file ${file.id}: ${error.message}`,
          );
        }
      }

      // 3. Clean failed/infected files older than 24 hours
      const staleCutoff = new Date(Date.now() - 86400 * 1000);
      const staleFiles = await this.fileRepo
        .createQueryBuilder("file")
        .where("(file.status = :failed OR file.status = :infected)", {
          failed: FileStatus.FAILED,
          infected: FileStatus.INFECTED,
        })
        .andWhere("file.createdAt < :cutoff", { cutoff: staleCutoff })
        .getMany();

      result.filesScanned += staleFiles.length;

      for (const file of staleFiles) {
        if (dto.dryRun) {
          result.filesDeleted++;
          result.storageFreed += file.size;
          continue;
        }
        try {
          await this.deleteFileAndThumbnails(file);
          result.filesDeleted++;
          result.storageFreed += file.size;
        } catch (error) {
          result.errors.push(
            `Failed to delete stale file ${file.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      result.errors.push(`Cleanup error: ${error.message}`);
      this.logger.error(`Cleanup failed: ${error.message}`);
    }

    return result;
  }

  private async deleteFileAndThumbnails(file: UploadedFile): Promise<void> {
    // Delete from storage backend
    const backend = this.backends.get(file.storageBackend);
    if (backend) {
      await backend.delete(file.storagePath);
    }

    // Delete thumbnails
    const thumbnails = await this.thumbnailRepo.find({
      where: { fileId: file.id },
    });

    for (const thumb of thumbnails) {
      if (backend) {
        await backend.delete(thumb.storagePath);
      }
    }

    // Delete thumbnail records
    await this.thumbnailRepo.delete({ fileId: file.id });

    // Delete file record
    await this.fileRepo.remove(file);

    this.logger.debug(`Deleted file ${file.id} and ${thumbnails.length} thumbnails`);
  }

  async getOrphanedFiles(): Promise<UploadedFile[]> {
    return this.fileRepo.find({
      where: { isOrphaned: true },
      order: { createdAt: "ASC" },
    });
  }

  async getExpiredFiles(): Promise<UploadedFile[]> {
    return this.fileRepo
      .createQueryBuilder("file")
      .where("file.expiresAt IS NOT NULL")
      .andWhere("file.expiresAt < :now", { now: new Date() })
      .orderBy("file.expiresAt", "ASC")
      .getMany();
  }
}
