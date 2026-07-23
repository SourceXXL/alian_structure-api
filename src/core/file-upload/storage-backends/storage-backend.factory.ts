import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageBackend } from '../interfaces/storage-backend.interface';
import { LocalStorageBackend } from './local-storage.backend';
import { S3StorageBackend } from './s3-storage.backend';
import { AzureBlobStorageBackend } from './azure-blob-storage.backend';
import { StorageBackendType } from '../entities/uploaded-file.entity';

@Injectable()
export class StorageBackendFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly localStorage: LocalStorageBackend,
    private readonly s3Storage: S3StorageBackend,
    private readonly azureStorage: AzureBlobStorageBackend,
  ) {}

  getBackend(type?: StorageBackendType): StorageBackend {
    const backendType = type || this.getDefaultBackend();
    
    switch (backendType) {
      case StorageBackendType.LOCAL:
        return this.localStorage;
      case StorageBackendType.S3:
        return this.s3Storage;
      case StorageBackendType.AZURE_BLOB:
        return this.azureStorage;
      default:
        throw new Error(`Unknown storage backend type: ${backendType}`);
    }
  }

  private getDefaultBackend(): StorageBackendType {
    const defaultBackend = this.configService.get<string>(
      'FILE_STORAGE_DEFAULT_BACKEND',
      'local',
    );

    switch (defaultBackend.toLowerCase()) {
      case 's3':
        return StorageBackendType.S3;
      case 'azure':
      case 'azure_blob':
        return StorageBackendType.AZURE_BLOB;
      default:
        return StorageBackendType.LOCAL;
    }
  }

  getAllBackends(): StorageBackend[] {
    return [this.localStorage, this.s3Storage, this.azureStorage];
  }
}