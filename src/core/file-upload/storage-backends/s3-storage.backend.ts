import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from 'aws-sdk';
import { createHash } from 'crypto';
import { Stream } from 'stream';
import { StorageBackend, StorageFile, UploadOptions } from '../interfaces/storage-backend.interface';

@Injectable()
export class S3StorageBackend implements StorageBackend {
  private s3: S3;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET', '');
    
    this.s3 = new S3({
      region: this.region,
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
    });
  }

  async upload(
    file: Buffer | Stream,
    filename: string,
    options?: UploadOptions,
  ): Promise<StorageFile> {
    const key = `uploads/${filename}`;
    const hash = createHash('sha256');
    
    let fileBuffer: Buffer;
    
    if (Buffer.isBuffer(file)) {
      fileBuffer = file;
      hash.update(file);
    } else {
      // Convert stream to buffer for hashing
      fileBuffer = await this.streamToBuffer(file);
      hash.update(fileBuffer);
    }

    const uploadParams: S3.PutObjectRequest = {
      Bucket: this.bucket,
      Key: key,
    Body: fileBuffer,
      ServerSideEncryption: options?.encrypt ? 'AES256' : undefined,
      Metadata: options?.metadata,
    };

    await this.s3.putObject(uploadParams).promise();

    const fileHash = hash.digest('hex');

    return {
      id: filename.split('.')[0],
      filename,
      originalName: filename,
      mimeType: this.getMimeType(filename),
      size: fileBuffer.length,
      path: `s3://${this.bucket}/${key}`,
      hash: fileHash,
      encrypted: options?.encrypt || false,
      createdAt: new Date(),
    };
  }

  async download(fileId: string): Promise<Stream> {
    const key = `uploads/${fileId}`;
    const result = this.s3.getObject({
      Bucket: this.bucket,
      Key: key,
    }).createReadStream();
    return result;
  }

  async delete(fileId: string): Promise<boolean> {
    try {
      await this.s3.deleteObject({
        Bucket: this.bucket,
        Key: `uploads/${fileId}`,
      }).promise();
      return true;
    } catch {
      return false;
    }
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      await this.s3.headObject({
        Bucket: this.bucket,
        Key: `uploads/${fileId}`,
      }).promise();
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(fileId: string): Promise<StorageFile | null> {
    try {
      const metadata = await this.s3.headObject({
        Bucket: this.bucket,
        Key: `uploads/${fileId}`,
      }).promise();

      return {
        id: fileId,
        filename: fileId,
        originalName: fileId,
        mimeType: metadata.ContentType || 'application/octet-stream',
        size: metadata.ContentLength || 0,
        path: `s3://${this.bucket}/uploads/${fileId}`,
        hash: '',
        encrypted: metadata.ServerSideEncryption !== undefined,
        createdAt: new Date(metadata.LastModified || Date.now()),
      };
    } catch {
      return null;
    }
  }

  async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<string> {
    return this.s3.getSignedUrl('getObject', {
      Bucket: this.bucket,
      Key: `uploads/${fileId}`,
      Expires: expiresIn,
    });
  }

  async getSize(fileId: string): Promise<number> {
    const metadata = await this.s3.headObject({
      Bucket: this.bucket,
      Key: `uploads/${fileId}`,
    }).promise();
    return metadata.ContentLength || 0;
  }

  async list(limit: number = 100, offset: number = 0): Promise<StorageFile[]> {
    const result = await this.s3.listObjectsV2({
      Bucket: this.bucket,
      Prefix: 'uploads/',
      MaxKeys: limit,
    }).promise();

    return (result.Contents || []).map((item) => ({
      id: item.Key?.split('/').pop() || '',
      filename: item.Key?.split('/').pop() || '',
      originalName: item.Key?.split('/').pop() || '',
      mimeType: this.getMimeType(item.Key || ''),
      size: item.Size || 0,
      path: `s3://${this.bucket}/${item.Key}`,
      hash: '',
      encrypted: false,
      createdAt: item.LastModified || new Date(),
    }));
  }

  private async streamToBuffer(stream: Stream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk));
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