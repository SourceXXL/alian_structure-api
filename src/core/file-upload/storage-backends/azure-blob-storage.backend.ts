import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, ContainerSASPermissions } from '@azure/storage-blob';
import { createHash } from 'crypto';
import { Stream } from 'stream';
import { StorageBackend, StorageFile, UploadOptions } from '../interfaces/storage-backend.interface';

@Injectable()
export class AzureBlobStorageBackend implements StorageBackend {
  private blobServiceClient: BlobServiceClient;
  private readonly containerName: string;
  private readonly accountName: string;
  private readonly accountKey: string;

  constructor(private readonly configService: ConfigService) {
    this.accountName = this.configService.get<string>('AZURE_STORAGE_ACCOUNT', '');
    this.accountKey = this.configService.get<string>('AZURE_STORAGE_KEY', '');
    this.containerName = this.configService.get<string>('AZURE_STORAGE_CONTAINER', 'uploads');
    
    const sharedKeyCredential = new StorageSharedKeyCredential(
      this.accountName,
      this.accountKey,
    );
    
    this.blobServiceClient = new BlobServiceClient(
      `https://${this.accountName}.blob.core.windows.net`,
      sharedKeyCredential,
    );
  }

  async upload(
    file: Buffer | Stream,
    filename: string,
    options?: UploadOptions,
  ): Promise<StorageFile> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(filename);
    
    const hash = createHash('sha256');
    let fileBuffer: Buffer;
    
    if (Buffer.isBuffer(file)) {
      fileBuffer = file;
      hash.update(file);
    } else {
      fileBuffer = await this.streamToBuffer(file);
      hash.update(fileBuffer);
    }

    const uploadOptions = {
      metadata: options?.metadata,
    };

    if (options?.encrypt) {
      // Azure automatically enables encryption for all storage accounts
      // Server-side encryption is enabled by default
    }

    await blockBlobClient.uploadData(fileBuffer, uploadOptions);
    const fileHash = hash.digest('hex');

    return {
      id: filename.split('.')[0],
      filename,
      originalName: filename,
      mimeType: this.getMimeType(filename),
      size: fileBuffer.length,
      path: `azure://${this.accountName}.blob.core.windows.net/${this.containerName}/${filename}`,
      hash: fileHash,
      encrypted: options?.encrypt || true, // Azure encrypts by default
      createdAt: new Date(),
    };
  }

  async download(fileId: string): Promise<Stream> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(fileId);
    const downloadResponse = await blockBlobClient.download();
    return downloadResponse.readableStreamBody!;
  }

  async delete(fileId: string): Promise<boolean> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileId);
      await blockBlobClient.delete();
      return true;
    } catch {
      return false;
    }
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileId);
      const exists = await blockBlobClient.exists();
      return exists;
    } catch {
      return false;
    }
  }

  async getMetadata(fileId: string): Promise<StorageFile | null> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileId);
      const properties = await blockBlobClient.getProperties();
      
      return {
        id: fileId,
        filename: fileId,
        originalName: fileId,
        mimeType: properties.contentType || 'application/octet-stream',
        size: properties.contentLength || 0,
        path: `azure://${this.accountName}.blob.core.windows.net/${this.containerName}/${fileId}`,
        hash: '',
        encrypted: true,
        createdAt: properties.lastModified || new Date(),
      };
    } catch {
      return null;
    }
  }

  async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(fileId);
    
    const expiryDate = new Date();
    expiryDate.setSeconds(expiryDate.getSeconds() + expiresIn);

    const sasToken = generateBlobSASQueryParameters({
      containerName: this.containerName,
      blobName: fileId,
      permissions: ContainerSASPermissions.parse('r'),
      startsOn: new Date(),
      expiresOn: expiryDate,
    }, new StorageSharedKeyCredential(this.accountName, this.accountKey)).toString();

    return `${blockBlobClient.url}?${sasToken}`;
  }

  async getSize(fileId: string): Promise<number> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(fileId);
    const properties = await blockBlobClient.getProperties();
    return properties.contentLength || 0;
  }

  async list(limit: number = 100, offset: number = 0): Promise<StorageFile[]> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blobs: StorageFile[] = [];
    
    let i = 0;
    for await (const blob of containerClient.listBlobsFlat()) {
      if (i >= offset && blobs.length < limit) {
        blobs.push({
          id: blob.name,
          filename: blob.name,
          originalName: blob.name,
          mimeType: this.getMimeType(blob.name),
          size: blob.properties.contentLength || 0,
          path: `azure://${this.accountName}.blob.core.windows.net/${this.containerName}/${blob.name}`,
          hash: '',
          encrypted: true,
          createdAt: blob.properties.lastModified || new Date(),
        });
      }
      i++;
      if (blobs.length >= limit) break;
    }

    return blobs;
  }

  private async streamToBuffer(stream: Stream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
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