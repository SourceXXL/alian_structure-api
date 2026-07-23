import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileTypeFromBuffer } from 'file-type';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  fileType?: string;
  mimeType?: string;
  actualMimeType?: string;
  isExtensionValid: boolean;
}

@Injectable()
export class FileValidationService {
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: Set<string>;
  private readonly dangerousExtensions: Set<string>;
  private readonly magicNumberVerifiers: Map<string, number[]>;

  constructor(private readonly configService: ConfigService) {
    // Configure maximum file size (default 100MB)
    this.maxFileSize = this.configService.get<number>(
      'MAX_FILE_SIZE',
      100 * 1024 * 1024,
    );

    // Configure allowed MIME types
    const defaultAllowedTypes = [
      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'application/json',
      // Archives
      'application/zip',
      'application/x-rar-compressed',
      // Audio/Video
      'audio/mpeg',
      'video/mp4',
      'video/webm',
    ];

    this.allowedMimeTypes = new Set(
      this.configService.get<string[]>('ALLOWED_MIME_TYPES', defaultAllowedTypes),
    );

    // Dangerous file extensions that should never be allowed
    this.dangerousExtensions = new Set([
      'exe', 'dll', 'bat', 'cmd', 'com', 'pif', 'scr', 'js', 'jse', 'wsf',
      'wsh', 'msc', 'jar', 'py', 'pyc', 'php', 'asp', 'aspx', 'cgi', 'swf',
      'sct', 'vbs', 'vbe', 'ps1', 'psm1', 'msh', 'sh', 'pl', 'rb', 'csh',
    ]);

    // Magic numbers for file verification (hex sequences that identify file types)
    this.magicNumberVerifiers = new Map([
      ['image/jpeg', [0xFF, 0xD8, 0xFF]],
      ['image/png', [0x89, 0x50, 0x4E, 0x47]],
      ['image/gif', [0x47, 0x49, 0x46, 0x38]],
      ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
      ['application/zip', [0x50, 0x4B, 0x03, 0x04]],
    ]);
  }

  /**
   * Validate a file buffer before processing
   */
  async validateFile(buffer: Buffer, originalName: string): Promise<ValidationResult> {
    const errors: string[] = [];
    let isExtensionValid = true;
    let detectedFileType: Awaited<ReturnType<typeof fileTypeFromBuffer>>;

    // 1. Check file size
    if (buffer.length > this.maxFileSize) {
      errors.push(
        `File size exceeds maximum allowed size of ${this.formatFileSize(this.maxFileSize)}. Got ${this.formatFileSize(buffer.length)}`,
      );
    }

    // 2. Check file extension
    const fileExtension = this.getFileExtension(originalName).toLowerCase();
    if (this.dangerousExtensions.has(fileExtension)) {
      isExtensionValid = false;
      errors.push(`File extension .${fileExtension} is not allowed for security reasons`);
    }

    // 3. Detect actual file type from content
    try {
      detectedFileType = await fileTypeFromBuffer(buffer);
    } catch (e) {
      errors.push('Failed to detect file type');
    }

    // 4. Verify file content matches declared extension
    const claimedMimeType = this.getMimeTypeFromExtension(fileExtension);
    const actualMimeType = detectedFileType?.mime;

    if (actualMimeType && !this.allowedMimeTypes.has(actualMimeType)) {
      errors.push(`File type ${actualMimeType} is not allowed`);
    }

    // 5. Verify magic numbers for supported file types
    if (actualMimeType && this.magicNumberVerifiers.has(actualMimeType)) {
      const isValidMagic = this.verifyMagicNumbers(buffer, actualMimeType);
      if (!isValidMagic) {
        errors.push(`File content does not match its claimed file type. Possible file tampering detected.`);
      }
    }

    // 6. Verify mime type spoofing
    if (claimedMimeType && actualMimeType && claimedMimeType !== actualMimeType) {
      // Some extensions map to multiple mime types, check if they're in the same category
      const claimedCategory = claimedMimeType.split('/')[0];
      const actualCategory = actualMimeType.split('/')[0];
      
      if (claimedCategory !== actualCategory) {
        errors.push(`File extension suggests ${claimedMimeType} but content is ${actualMimeType}. This file may be spoofed.`);
      }
    }

    // 7. Calculate and verify file hash for integrity
    const fileHash = this.calculateFileHash(buffer);

    return {
      valid: errors.length === 0,
      errors,
      fileType: detectedFileType?.ext,
      mimeType: claimedMimeType,
      actualMimeType,
      isExtensionValid,
    };
  }

  /**
   * Validate a chunk for resumable uploads
   */
  validateChunk(chunkNumber: number, totalChunks: number, chunkSize: number): boolean {
    if (chunkNumber < 1 || chunkNumber > totalChunks) {
      throw new AppException(
        ErrorCodes.INVALID_CHUNK,
        `Invalid chunk number ${chunkNumber} for ${totalChunks} total chunks`,
      );
    }

    // Maximum chunk size validation (prevent malicious large chunks)
    const maxChunkSize = 10 * 1024 * 1024; // 10MB per chunk
    if (chunkSize > maxChunkSize) {
      throw new AppException(
        ErrorCodes.CHUNK_TOO_LARGE,
        `Chunk size ${this.formatFileSize(chunkSize)} exceeds maximum of ${this.formatFileSize(maxChunkSize)}`,
      );
    }

    return true;
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeTypeFromExtension(extension: string): string {
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain',
      json: 'application/json',
      zip: 'application/zip',
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
    };
    return mimeMap[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Verify file's magic numbers match the expected file type
   */
  private verifyMagicNumbers(buffer: Buffer, mimeType: string): boolean {
    const expectedMagic = this.magicNumberVerifiers.get(mimeType);
    if (!expectedMagic) return true; // No magic number check for this file type

    for (let i = 0; i < expectedMagic.length; i++) {
      if (buffer[i] !== expectedMagic[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Calculate SHA-256 hash of file buffer
   */
  private calculateFileHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get the configured maximum file size
   */
  getMaxFileSize(): number {
    return this.maxFileSize;
  }

  /**
   * Get all allowed MIME types
   */
  getAllowedMimeTypes(): string[] {
    return Array.from(this.allowedMimeTypes);
  }
}