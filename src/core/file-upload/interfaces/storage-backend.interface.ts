import { Stream } from 'stream';

export interface StorageFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  hash: string;
  encrypted: boolean;
  createdAt: Date;
}

export interface UploadOptions {
  encrypt?: boolean;
  metadata?: Record<string, any>;
  generateThumbnails?: boolean;
  isTemporary?: boolean;
  isThumbnail?: boolean;
}

export interface DownloadOptions {
  expiresIn?: number; // seconds
}

export interface StorageBackend {
  /**
   * Upload a file to the storage backend
   */
  upload(
    file: Buffer | Stream,
    filename: string,
    options?: UploadOptions,
  ): Promise<StorageFile>;

  /**
   * Download a file from the storage backend
   */
  download(fileId: string): Promise<Buffer | Stream>;

  /**
   * Delete a file from the storage backend
   */
  delete(fileId: string): Promise<boolean>;

  /**
   * Check if a file exists
   */
  exists(fileId: string): Promise<boolean>;

  /**
   * Get file metadata
   */
  getMetadata(fileId: string): Promise<StorageFile | null>;

  /**
   * Generate a signed URL for temporary access
   */
  getSignedUrl(fileId: string, expiresIn?: number): Promise<string>;

  /**
   * Get file size
   */
  getSize(fileId: string): Promise<number>;

  /**
   * List files with pagination
   */
  list(limit?: number, offset?: number): Promise<StorageFile[]>;
}