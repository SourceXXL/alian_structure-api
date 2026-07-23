import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream, unlink, stat, readdir } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { Stream } from 'stream';
import { promisify } from 'util';
import { StorageBackend, StorageFile, UploadOptions } from '../interfaces/storage-backend.interface';
import { UrlSigningService } from '../services/url-signing.service';

const unlinkAsync = promisify(unlink);
const statAsync = promisify(stat);
const readdirAsync = promisify(readdir);

@Injectable()
export class LocalStorageBackend implements StorageBackend {
  private readonly uploadPath: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly urlSigningService: UrlSigningService,
  ) {
    this.uploadPath = this.configService.get<string>(
      'LOCAL_STORAGE_PATH',
      './uploads',
    );
    this.baseUrl = this.configService.get<string>(
      'APP_BASE_URL',
      'http://localhost:3000',
    );
    this.initializeStorage();
  }

  private async initializeStorage(): Promise<void> {
    await mkdir(this.uploadPath, { recursive: true });
    // Create subdirectories for organization
    await mkdir(join(this.uploadPath, 'temp'), { recursive: true });
    await mkdir(join(this.uploadPath, 'permanent'), { recursive: true });
    await mkdir(join(this.uploadPath, 'thumbnails'), { recursive: true });
  }

  async upload(
    file: Buffer | Stream,
    filename: string,
    options?: UploadOptions,
  ): Promise<StorageFile> {
    // Determine which directory to store the file in
    let subDir = 'permanent';
    if (options?.isTemporary) {
      subDir = 'temp';
    } else if (options?.isThumbnail) {
      subDir = 'thumbnails';
    }
    
    const filePath = join(this.uploadPath, subDir, filename);
    const fileDir = dirname(filePath);
    
    await mkdir(fileDir, { recursive: true });

    // Calculate file hash
    const hash = createHash('sha256');
    
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      
      if (Buffer.isBuffer(file)) {
        hash.update(file);
        writeStream.write(file);
        writeStream.end();
      } else {
        file.on('data', (chunk) => {
          hash.update(chunk);
          writeStream.write(chunk);
        });
        file.on('end', () => writeStream.end());
      }

      writeStream.on('finish', async () => {
        const stats = await statAsync(filePath);
        const fileHash = hash.digest('hex');
        
        resolve({
          id: filename.split('.')[0],
          filename,
          originalName: filename,
          mimeType: this.getMimeType(filename),
          size: stats.size,
          path: filePath,
          hash: fileHash,
          encrypted: options?.encrypt || false,
          createdAt: new Date(),
        });
      });

      writeStream.on('error', reject);
    });
  }

  async download(fileId: string): Promise<Stream> {
    const filePath = await this.getFilePath(fileId);
    return createReadStream(filePath);
  }

  async delete(fileId: string): Promise<boolean> {
    try {
      const filePath = await this.getFilePath(fileId);
      await unlinkAsync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      const filePath = await this.getFilePath(fileId);
      await statAsync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(fileId: string): Promise<StorageFile | null> {
    try {
      const filePath = await this.getFilePath(fileId);
      const stats = await statAsync(filePath);
      
      return {
        id: fileId,
        filename: basename(filePath),
        originalName: basename(filePath),
        mimeType: this.getMimeType(filePath),
        size: stats.size,
        path: filePath,
        hash: '',
        encrypted: false,
        createdAt: stats.birthtime,
      };
    } catch {
      return null;
    }
  }

  async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<string> {
    // Use the centralized URL signing service to generate a signed token
    const { token, expiry } = this.urlSigningService.generateSignedUrl(fileId, expiresIn);
    
    // Return a URL that includes the signed token as a query parameter
    const relativePath = `/api/files/download/${fileId}?token=${token}`;
    return `${this.baseUrl}${relativePath}`;
  }

  async getSize(fileId: string): Promise<number> {
    const filePath = await this.getFilePath(fileId);
    const stats = await statAsync(filePath);
    return stats.size;
  }

  async list(limit: number = 100, offset: number = 0): Promise<StorageFile[]> {
    const files = await readdirAsync(join(this.uploadPath, 'permanent'));
    const paginatedFiles = files.slice(offset, offset + limit);
    
    return Promise.all(
      paginatedFiles.map(async (filename) => {
        const metadata = await this.getMetadata(filename.split('.')[0]);
        return metadata!;
      }),
    );
  }

  private async getFilePath(fileId: string): Promise<string> {
    // Check all subdirectories for the file
    // First check if it's a temporary chunk file
    if (fileId.includes('_chunk_')) {
      const tempPath = join(this.uploadPath, 'temp', `${fileId}`);
      try {
        await statAsync(tempPath);
        return tempPath;
      } catch {
        // Continue searching if not found in temp
      }
    }
    
    // Check if it's a thumbnail
    if (fileId.includes('_')) {
      const thumbnailsDir = join(this.uploadPath, 'thumbnails');
      const thumbnailFiles = await readdirAsync(thumbnailsDir);
      const matchingThumbnail = thumbnailFiles.find(file => file.startsWith(fileId));
      if (matchingThumbnail) {
        return join(thumbnailsDir, matchingThumbnail);
      }
    }
    
    // Default to permanent storage
    const permanentDir = join(this.uploadPath, 'permanent');
    const permanentFiles = await readdirAsync(permanentDir);
    const matchingFile = permanentFiles.find(file => file.startsWith(fileId));
    if (matchingFile) {
      return join(permanentDir, matchingFile);
    }
    
    throw new Error(`File with ID ${fileId} not found in any storage directory`);
  }

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
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
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
      zip: 'application/zip',
      json: 'application/json',
      txt: 'text/plain',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}