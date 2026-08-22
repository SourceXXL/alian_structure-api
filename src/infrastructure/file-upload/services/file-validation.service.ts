import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileCategory } from "../entities/uploaded-file.entity";

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  category: FileCategory;
  detectedMimeType: string;
}

@Injectable()
export class FileValidationService {
  private readonly logger = new Logger(FileValidationService.name);
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: Map<FileCategory, string[]>;
  private readonly blockedExtensions: string[];

  constructor(private readonly configService: ConfigService) {
    this.maxFileSize =
      this.configService.get<number>("FILE_MAX_SIZE_BYTES") ||
      50 * 1024 * 1024; // 50MB default

    this.blockedExtensions = [
      "exe",
      "bat",
      "cmd",
      "com",
      "msi",
      "scr",
      "pif",
      "vbs",
      "vbe",
      "js",
      "jse",
      "ws",
      "wsh",
      "ps1",
      "ps2",
      "psc1",
      "psc2",
      "reg",
      "inf",
      "sct",
      "hta",
      "cpl",
      "msp",
      "mst",
      "gadget",
    ];

    this.allowedMimeTypes = new Map([
      [
        FileCategory.IMAGE,
        [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/svg+xml",
          "image/tiff",
          "image/bmp",
          "image/avif",
        ],
      ],
      [
        FileCategory.DOCUMENT,
        [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "text/plain",
          "text/csv",
          "application/json",
          "application/xml",
        ],
      ],
      [
        FileCategory.VIDEO,
        [
          "video/mp4",
          "video/webm",
          "video/ogg",
          "video/quicktime",
          "video/x-msvideo",
          "video/x-matroska",
        ],
      ],
      [
        FileCategory.AUDIO,
        [
          "audio/mpeg",
          "audio/wav",
          "audio/ogg",
          "audio/webm",
          "audio/aac",
          "audio/flac",
          "audio/mp4",
        ],
      ],
      [
        FileCategory.ARCHIVE,
        [
          "application/zip",
          "application/x-tar",
          "application/gzip",
          "application/x-rar-compressed",
          "application/x-7z-compressed",
          "application/x-bzip2",
        ],
      ],
    ]);
  }

  async validate(
    file: Express.Multer.File,
    maxFileSize?: number,
    allowedCategories?: FileCategory[],
  ): Promise<FileValidationResult> {
    const errors: string[] = [];
    const effectiveMaxSize = maxFileSize || this.maxFileSize;

    // Size validation
    if (file.size > effectiveMaxSize) {
      errors.push(
        `File size ${file.size} exceeds maximum ${effectiveMaxSize} bytes`,
      );
    }

    if (file.size === 0) {
      errors.push("File is empty");
    }

    // Extension validation
    const ext = this.extractExtension(file.originalname);
    if (this.blockedExtensions.includes(ext.toLowerCase())) {
      errors.push(`File extension .${ext} is blocked for security reasons`);
    }

    // MIME type validation
    const category = this.categorizeFile(file.mimetype);
    if (category === FileCategory.OTHER) {
      errors.push(`MIME type ${file.mimetype} is not allowed`);
    }

    // Category filtering
    if (allowedCategories && allowedCategories.length > 0) {
      if (!allowedCategories.includes(category)) {
        errors.push(
          `File category ${category} is not allowed. Allowed: ${allowedCategories.join(", ")}`,
        );
      }
    }

    // Magic byte validation
    if (file.buffer) {
      const detectedMime = this.detectMimeTypeFromBuffer(file.buffer);
      if (
        detectedMime &&
        detectedMime !== file.mimetype &&
        !this.isMimeCompatible(file.mimetype, detectedMime)
      ) {
        errors.push(
          `File content does not match declared MIME type. Declared: ${file.mimetype}, detected: ${detectedMime}`,
        );
      }
    }

    // Double extension check (e.g., image.jpg.exe)
    const parts = file.originalname.split(".");
    if (parts.length > 2) {
      const secondToLast = parts[parts.length - 2].toLowerCase();
      if (this.blockedExtensions.includes(secondToLast)) {
        errors.push(
          `Suspicious double extension detected: ${file.originalname}`,
        );
      }
    }

    const valid = errors.length === 0;
    if (!valid) {
      this.logger.warn(
        `File validation failed for ${file.originalname}: ${errors.join("; ")}`,
      );
    }

    return {
      valid,
      errors,
      category,
      detectedMimeType: file.mimetype,
    };
  }

  categorizeFile(mimeType: string): FileCategory {
    for (const [category, types] of this.allowedMimeTypes) {
      if (types.includes(mimeType)) {
        return category;
      }
    }
    return FileCategory.OTHER;
  }

  isMimeAllowed(mimeType: string): boolean {
    for (const types of this.allowedMimeTypes.values()) {
      if (types.includes(mimeType)) return true;
    }
    return false;
  }

  getAllowedMimeTypes(): string[] {
    const all: string[] = [];
    for (const types of this.allowedMimeTypes.values()) {
      all.push(...types);
    }
    return all;
  }

  private extractExtension(filename: string): string {
    const parts = filename.split(".");
    return parts.length > 1 ? parts[parts.length - 1] : "";
  }

  private detectMimeTypeFromBuffer(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    // Magic bytes detection
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return "image/png";
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return "image/gif";
    }
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46
    ) {
      // RIFF container - check for WEBP
      if (
        buffer.length > 12 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      ) {
        return "image/webp";
      }
      return "video/webm"; // Could be audio/webm too, but close enough
    }
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44) {
      return "application/pdf";
    }
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03) {
      return "application/zip";
    }
    if (
      buffer[0] === 0x1f &&
      buffer[1] === 0x8b &&
      buffer[2] === 0x08
    ) {
      return "application/gzip";
    }

    // MP4/MOV: ftyp at offset 4
    if (
      buffer.length > 8 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      return "video/mp4";
    }

    return null;
  }

  private isMimeCompatible(declared: string, detected: string): boolean {
    // Allow some flexibility (e.g., image/jpg vs image/jpeg)
    if (declared === "image/jpg" && detected === "image/jpeg") return true;
    if (declared === "image/jpeg" && detected === "image/jpg") return true;
    return declared === detected;
  }
}
