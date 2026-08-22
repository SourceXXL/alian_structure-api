import { Readable } from "stream";

export interface StorageUploadResult {
  path: string;
  bucket?: string;
  key?: string;
  size: number;
  checksum: string;
  url?: string;
}

export interface StorageFileInfo {
  exists: boolean;
  size?: number;
  lastModified?: Date;
  contentType?: string;
  etag?: string;
}

export interface StorageBackend {
  upload(
    file: Buffer | Readable,
    path: string,
    contentType: string,
  ): Promise<StorageUploadResult>;

  download(path: string): Promise<Readable>;

  delete(path: string): Promise<void>;

  getSignedUrl(path: string, expiresIn: number): Promise<string>;

  getFileInfo(path: string): Promise<StorageFileInfo>;

  copy(srcPath: string, destPath: string): Promise<void>;

  listFiles(prefix: string): Promise<string[]>;
}
