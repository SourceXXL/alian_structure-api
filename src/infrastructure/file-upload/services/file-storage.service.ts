import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { v4 as uuid } from "uuid";
import * as crypto from "crypto";
import {
  UploadedFile,
  FileStatus,
  FileStorageBackend,
  FileCategory,
} from "../entities/uploaded-file.entity";
import { FileThumbnail } from "../entities/file-thumbnail.entity";
import { StorageBackend } from "../storage/storage-backend.interface";
import { LocalStorageBackend } from "../storage/local-storage.backend";
import { S3StorageBackend } from "../storage/s3-storage.backend";
import { AzureBlobStorageBackend } from "../storage/azure-blob-storage.backend";
import { FileValidationService } from "./file-validation.service";
import { FileScanService } from "./file-scan.service";
import { FileMetadataService } from "./file-metadata.service";
import {
  UploadFileDto,
  UpdateFileMetadataDto,
  GetDownloadUrlDto,
  FileSearchDto,
} from "../dto/file-upload.dto";

export interface UploadResult {
  file: UploadedFile;
  scanResult?: any;
  metadata?: any;
  thumbnails?: FileThumbnail[];
}

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly storageBackend: FileStorageBackend;
  private readonly defaultExpiryHours: number;

  private backends: Map<FileStorageBackend, StorageBackend>;

  constructor(
    @InjectRepository(UploadedFile)
    private readonly fileRepo: Repository<UploadedFile>,
    @InjectRepository(FileThumbnail)
    private readonly thumbnailRepo: Repository<FileThumbnail>,
    private readonly configService: ConfigService,
    private readonly validationService: FileValidationService,
    private readonly scanService: FileScanService,
    private readonly metadataService: FileMetadataService,
    private readonly localStorage: LocalStorageBackend,
    private readonly s3Storage: S3StorageBackend,
    private readonly azureStorage: AzureBlobStorageBackend,
  ) {
    this.storageBackend =
      (this.configService.get<string>("FILE_STORAGE_BACKEND") as FileStorageBackend) ||
      FileStorageBackend.LOCAL;
    this.defaultExpiryHours =
      this.configService.get<number>("FILE_DEFAULT_EXPIRY_HOURS") || 720; // 30 days

    this.backends = new Map<FileStorageBackend, StorageBackend>([
      [FileStorageBackend.LOCAL, this.localStorage],
      [FileStorageBackend.S3, this.s3Storage],
      [FileStorageBackend.AZURE_BLOB, this.azureStorage],
    ]);
  }

  private getBackend(type?: FileStorageBackend): StorageBackend {
    const backendType = type || this.storageBackend;
    const backend = this.backends.get(backendType);
    if (!backend) {
      throw new BadRequestException(
        `Storage backend "${backendType}" is not available`,
      );
    }
    return backend;
  }

  async upload(
    file: Express.Multer.File,
    userId: string,
    dto: UploadFileDto = {},
  ): Promise<UploadResult> {
    // Validate file
    const validation = await this.validationService.validate(file);
    if (!validation.valid) {
      throw new BadRequestException(
        `File validation failed: ${validation.errors.join("; ")}`,
      );
    }

    // Generate storage names
    const fileId = uuid();
    const ext = file.originalname.split(".").pop() || "";
    const storedName = `${fileId}.${ext}`;
    const storagePath = `${userId}/${new Date().toISOString().slice(0, 7)}/${storedName}`;

    // Encrypt if configured
    const shouldEncrypt =
      this.configService.get<boolean>("FILE_ENCRYPTION_ENABLED") === true;
    let buffer = file.buffer;
    let encryptionKey: string | undefined;

    if (shouldEncrypt) {
      const result = this.encryptBuffer(buffer);
      buffer = result.encrypted;
      encryptionKey = result.key;
    }

    // Create entity
    const uploadedFile = this.fileRepo.create({
      id: fileId,
      userId,
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      size: file.size,
      category: validation.category,
      checksum: crypto
        .createHash("sha256")
        .update(file.buffer)
        .digest("hex"),
      storageBackend: (dto.storageBackend as FileStorageBackend) || this.storageBackend,
      storagePath,
      status: FileStatus.UPLOADING,
      encrypted: shouldEncrypt,
      encryptionKey,
      tags: dto.tags,
      description: dto.description,
      expiresAt: dto.expiresIn
        ? new Date(Date.now() + dto.expiresIn * 1000)
        : new Date(Date.now() + this.defaultExpiryHours * 3600 * 1000),
    });

    // Upload to storage backend
    const backend = this.getBackend(dto.storageBackend as FileStorageBackend);
    const uploadResult = await backend.upload(buffer, storagePath, file.mimetype);

    uploadedFile.storagePath = uploadResult.path;
    if (uploadResult.bucket) {
      uploadedFile.storageBucket = uploadResult.bucket;
    }
    uploadedFile.status = FileStatus.PROCESSING;
    await this.fileRepo.save(uploadedFile);

    this.logger.log(
      `File uploaded: ${fileId} (${file.originalname}, ${file.size} bytes) by user ${userId}`,
    );

    // Virus scan
    let scanResult;
    try {
      scanResult = await this.scanService.scanFile(uploadedFile, file.buffer);
    } catch (error) {
      this.logger.error(`Virus scan failed for ${fileId}: ${error.message}`);
    }

    // Extract metadata
    let metadata;
    try {
      metadata = await this.metadataService.extractMetadata(
        uploadedFile,
        file.buffer,
      );
    } catch (error) {
      this.logger.error(
        `Metadata extraction failed for ${fileId}: ${error.message}`,
      );
    }

    // Auto-generate thumbnails for images
    let thumbnails: FileThumbnail[] | undefined;
    if (validation.category === FileCategory.IMAGE) {
      try {
        const thumb = await this.metadataService.generateThumbnail(
          uploadedFile,
          200,
          200,
          "webp",
          "thumb-sm",
        );
        thumbnails = [thumb];

        const largeThumb = await this.metadataService.generateThumbnail(
          uploadedFile,
          800,
          800,
          "webp",
          "thumb-lg",
        );
        thumbnails.push(largeThumb);
      } catch (error) {
        this.logger.warn(
          `Thumbnail generation failed for ${fileId}: ${error.message}`,
        );
      }
    }

    // Mark as ready if scan passed
    if (
      scanResult &&
      scanResult.status !== ("infected" as any)
    ) {
      uploadedFile.status = FileStatus.READY;
    }
    await this.fileRepo.save(uploadedFile);

    return { file: uploadedFile, scanResult, metadata, thumbnails };
  }

  async getById(fileId: string): Promise<UploadedFile> {
    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }
    return file;
  }

  async getByUserId(userId: string): Promise<UploadedFile[]> {
    return this.fileRepo.find({
      where: { userId, isOrphaned: false },
      order: { createdAt: "DESC" },
    });
  }

  async search(
    dto: FileSearchDto,
    userId?: string,
  ): Promise<{ files: UploadedFile[]; total: number }> {
    const qb = this.fileRepo.createQueryBuilder("file");
    qb.where("file.isOrphaned = :isOrphaned", { isOrphaned: false });

    if (userId) {
      qb.andWhere("file.userId = :userId", { userId });
    }
    if (dto.name) {
      qb.andWhere("file.originalName ILIKE :name", { name: `%${dto.name}%` });
    }
    if (dto.category) {
      qb.andWhere("file.category = :category", { category: dto.category });
    }
    if (dto.maxSize) {
      qb.andWhere("file.size <= :maxSize", { maxSize: dto.maxSize });
    }
    if (dto.minSize) {
      qb.andWhere("file.size >= :minSize", { minSize: dto.minSize });
    }
    if (dto.tags && dto.tags.length > 0) {
      qb.andWhere("file.tags @> :tags", { tags: dto.tags });
    }

    const total = await qb.getCount();
    const files = await qb
      .orderBy("file.createdAt", "DESC")
      .skip(dto.offset || 0)
      .take(dto.limit || 20)
      .getMany();

    return { files, total };
  }

  async updateMetadata(
    fileId: string,
    dto: UpdateFileMetadataDto,
  ): Promise<UploadedFile> {
    const file = await this.getById(fileId);
    if (dto.tags) file.tags = dto.tags;
    if (dto.description) file.description = dto.description;
    if (dto.metadata) {
      file.metadata = { ...file.metadata, ...dto.metadata };
    }
    return this.fileRepo.save(file);
  }

  async getDownloadUrl(
    fileId: string,
    dto: GetDownloadUrlDto = {},
  ): Promise<string> {
    const file = await this.getById(fileId);
    const expiresIn = dto.expiresIn || 3600;
    const backend = this.getBackend(file.storageBackend);
    const url = await backend.getSignedUrl(file.storagePath, expiresIn);

    file.downloadCount++;
    await this.fileRepo.save(file);

    return url;
  }

  async download(fileId: string): Promise<{ stream: any; file: UploadedFile }> {
    const file = await this.getById(fileId);
    if (file.status !== FileStatus.READY) {
      throw new BadRequestException(
        `File is not ready for download (status: ${file.status})`,
      );
    }
    const backend = this.getBackend(file.storageBackend);
    const stream = await backend.download(file.storagePath);

    file.downloadCount++;
    await this.fileRepo.save(file);

    return { stream, file };
  }

  async delete(fileId: string): Promise<void> {
    const file = await this.getById(fileId);
    const backend = this.getBackend(file.storageBackend);
    await backend.delete(file.storagePath);

    file.status = FileStatus.DELETED;
    await this.fileRepo.save(file);

    this.logger.log(`File deleted: ${fileId}`);
  }

  async markOrphaned(fileId: string): Promise<void> {
    const file = await this.getById(fileId);
    file.isOrphaned = true;
    await this.fileRepo.save(file);
  }

  async getStorageStats(userId?: string): Promise<{
    totalFiles: number;
    totalSize: number;
    byCategory: Record<string, { count: number; size: number }>;
    byBackend: Record<string, { count: number; size: number }>;
  }> {
    const qb = this.fileRepo.createQueryBuilder("file");
    if (userId) {
      qb.where("file.userId = :userId", { userId });
    }

    const files = await qb.getMany();

    const stats = {
      totalFiles: files.length,
      totalSize: 0,
      byCategory: {} as Record<string, { count: number; size: number }>,
      byBackend: {} as Record<string, { count: number; size: number }>,
    };

    for (const file of files) {
      stats.totalSize += file.size;

      if (!stats.byCategory[file.category]) {
        stats.byCategory[file.category] = { count: 0, size: 0 };
      }
      stats.byCategory[file.category].count++;
      stats.byCategory[file.category].size += file.size;

      if (!stats.byBackend[file.storageBackend]) {
        stats.byBackend[file.storageBackend] = { count: 0, size: 0 };
      }
      stats.byBackend[file.storageBackend].count++;
      stats.byBackend[file.storageBackend].size += file.size;
    }

    return stats;
  }

  private encryptBuffer(buffer: Buffer): {
    encrypted: Buffer;
    key: string;
  } {
    const key = crypto.randomBytes(32).toString("hex");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(key, "hex"),
      iv,
    );
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return {
      encrypted: Buffer.concat([iv, encrypted]),
      key,
    };
  }
}
