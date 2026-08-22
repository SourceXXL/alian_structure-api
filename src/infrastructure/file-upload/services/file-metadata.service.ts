import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UploadedFile, FileCategory } from "../entities/uploaded-file.entity";
import { FileThumbnail } from "../entities/file-thumbnail.entity";

export interface ImageDimensions {
  width: number;
  height: number;
  format: string;
}

export interface ExtractedMetadata {
  width?: number;
  height?: number;
  format?: string;
  duration?: number;
  pageCount?: number;
  colorSpace?: string;
  dpi?: number;
  EXIF?: Record<string, any>;
}

@Injectable()
export class FileMetadataService {
  private readonly logger = new Logger(FileMetadataService.name);

  constructor(
    @InjectRepository(UploadedFile)
    private readonly fileRepo: Repository<UploadedFile>,
    @InjectRepository(FileThumbnail)
    private readonly thumbnailRepo: Repository<FileThumbnail>,
  ) {}

  async extractMetadata(
    file: UploadedFile,
    buffer: Buffer,
  ): Promise<ExtractedMetadata> {
    const metadata: ExtractedMetadata = {};

    switch (file.category) {
      case FileCategory.IMAGE:
        const imageMeta = this.extractImageMetadata(buffer, file.mimeType);
        Object.assign(metadata, imageMeta);
        break;
      case FileCategory.DOCUMENT:
        const docMeta = this.extractDocumentMetadata(buffer, file.mimeType);
        Object.assign(metadata, docMeta);
        break;
      case FileCategory.VIDEO:
      case FileCategory.AUDIO:
        const mediaMeta = this.extractMediaMetadata(buffer, file.mimeType);
        Object.assign(metadata, mediaMeta);
        break;
    }

    // Save metadata to the file record
    file.width = metadata.width;
    file.height = metadata.height;
    file.format = metadata.format;
    file.duration = metadata.duration;
    file.pageCount = metadata.pageCount;
    file.metadata = {
      ...file.metadata,
      ...metadata,
    };
    await this.fileRepo.save(file);

    this.logger.debug(
      `Metadata extracted for ${file.id}: ${JSON.stringify(metadata)}`,
    );

    return metadata;
  }

  async generateThumbnail(
    file: UploadedFile,
    width: number,
    height: number,
    format: string = "webp",
    variant: string = "default",
  ): Promise<FileThumbnail> {
    if (file.category !== FileCategory.IMAGE) {
      throw new Error("Thumbnails can only be generated for image files");
    }

    const storedName = `${file.storedName}_${variant}_${width}x${height}.${format}`;
    const storagePath = `thumbnails/${file.userId}/${storedName}`;

    // For a real implementation, use sharp or jimp.
    // Here we provide the scaffolding and placeholder for when
    // the image processing library is installed.
    try {
      const sharp = (await import("sharp")).default;
      const processedBuffer = await sharp(file.metadata?.originalBuffer || Buffer.alloc(0))
        .resize(width, height, { fit: "cover" })
        .toFormat(format as any)
        .toBuffer();

      const thumbnail = this.thumbnailRepo.create({
        fileId: file.id,
        storedName,
        storagePath,
        width,
        height,
        format,
        size: processedBuffer.length,
        variant,
      });

      const saved = await this.thumbnailRepo.save(thumbnail);
      this.logger.log(
        `Thumbnail generated for ${file.id}: ${variant} ${width}x${height}`,
      );
      return saved;
    } catch {
      // Fallback: create metadata record without actual image processing
      this.logger.warn(
        "sharp not available; creating thumbnail metadata only. Install 'sharp' for image processing.",
      );
      const thumbnail = this.thumbnailRepo.create({
        fileId: file.id,
        storedName,
        storagePath,
        width,
        height,
        format,
        size: 0,
        variant,
      });
      return this.thumbnailRepo.save(thumbnail);
    }
  }

  async getThumbnails(fileId: string): Promise<FileThumbnail[]> {
    return this.thumbnailRepo.find({
      where: { fileId },
      order: { createdAt: "DESC" },
    });
  }

  async optimizeImage(
    buffer: Buffer,
    options: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: string;
    } = {},
  ): Promise<Buffer> {
    const {
      maxWidth = 2048,
      maxHeight = 2048,
      quality = 80,
      format = "webp",
    } = options;

    try {
      const sharp = (await import("sharp")).default;
      return await sharp(buffer)
        .resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
    } catch {
      this.logger.warn(
        "sharp not available; image optimization skipped.",
      );
      return buffer;
    }
  }

  private extractImageMetadata(
    buffer: Buffer,
    mimeType: string,
  ): Partial<ExtractedMetadata> {
    // Parse image dimensions from header bytes
    const dims = this.parseImageDimensions(buffer);
    return {
      width: dims?.width,
      height: dims?.height,
      format: this.getFormatFromMime(mimeType),
    };
  }

  private extractDocumentMetadata(
    buffer: Buffer,
    mimeType: string,
  ): Partial<ExtractedMetadata> {
    const format = this.getFormatFromMime(mimeType);
    const pageCount = this.estimatePdfPageCount(buffer, mimeType);
    return { format, pageCount };
  }

  private extractMediaMetadata(
    buffer: Buffer,
    mimeType: string,
  ): Partial<ExtractedMetadata> {
    return {
      format: this.getFormatFromMime(mimeType),
      duration: undefined, // Would require full media parsing
    };
  }

  private parseImageDimensions(
    buffer: Buffer,
  ): ImageDimensions | null {
    if (buffer.length < 8) return null;

    // PNG
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      if (buffer.length >= 24) {
        return {
          width: buffer.readUInt32BE(16),
          height: buffer.readUInt32BE(20),
          format: "png",
        };
      }
    }

    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      const dims = this.parseJpegDimensions(buffer);
      if (dims) return { ...dims, format: "jpeg" };
    }

    // GIF
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46
    ) {
      if (buffer.length >= 10) {
        return {
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8),
          format: "gif",
        };
      }
    }

    // WebP
    if (
      buffer.length >= 30 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      const isLossy = buffer[12] === 0x4c && buffer[13] === 0x45;
      const isLossless = buffer[12] === 0x4c && buffer[13] === 0x41;
      if (isLossy && buffer.length >= 30) {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
          format: "webp",
        };
      }
      if (isLossless && buffer.length >= 25) {
        return {
          width: (buffer.readUInt32LE(21) & 0x3fff) + 1,
          height: (buffer.readUInt32LE(21) >> 18 & 0x3fff) + 1,
          format: "webp",
        };
      }
    }

    return null;
  }

  private parseJpegDimensions(
    buffer: Buffer,
  ): { width: number; height: number } | null {
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (offset + 9 < buffer.length) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const segLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segLength;
    }
    return null;
  }

  private estimatePdfPageCount(
    buffer: Buffer,
    mimeType: string,
  ): number | undefined {
    if (mimeType !== "application/pdf") return undefined;
    const content = buffer.toString("latin1");
    const matches = content.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  }

  private getFormatFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "application/pdf": "pdf",
      "video/mp4": "mp4",
      "audio/mpeg": "mp3",
    };
    return map[mimeType] || mimeType.split("/").pop() || "unknown";
  }
}
