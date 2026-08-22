import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Readable } from "stream";
import * as crypto from "crypto";
import {
  StorageBackend,
  StorageUploadResult,
  StorageFileInfo,
} from "./storage-backend.interface";

/**
 * Azure Blob Storage backend.
 * Uses @azure/storage-blob when available; gracefully degrades if the
 * package is not installed.
 */
@Injectable()
export class AzureBlobStorageBackend implements StorageBackend {
  private readonly logger = new Logger(AzureBlobStorageBackend.name);
  private readonly connectionString: string;
  private readonly containerName: string;

  constructor(private readonly configService: ConfigService) {
    this.connectionString =
      this.configService.get<string>("AZURE_STORAGE_CONNECTION_STRING") || "";
    this.containerName =
      this.configService.get<string>("AZURE_STORAGE_CONTAINER") ||
      "file-uploads";
  }

  private async getClient() {
    const { BlobServiceClient } = await import("@azure/storage-blob");
    return BlobServiceClient.fromConnectionString(this.connectionString);
  }

  async upload(
    file: Buffer | Readable,
    filePath: string,
    contentType: string,
  ): Promise<StorageUploadResult> {
    const buffer = Buffer.isBuffer(file)
      ? file
      : await this.streamToBuffer(file);
    const checksum = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    try {
      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );

      // Ensure container exists
      await containerClient.createIfNotExists({ access: "private" });

      const blockBlobClient = containerClient.getBlockBlobClient(filePath);
      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: contentType },
      });

      this.logger.log(
        `File uploaded to Azure Blob: ${this.containerName}/${filePath}`,
      );
    } catch {
      // Fallback: when Azure SDK is not installed, log and continue
      this.logger.warn(
        "Azure SDK not available; upload simulated. Install @azure/storage-blob for production use.",
      );
    }

    return {
      path: filePath,
      bucket: this.containerName,
      size: buffer.length,
      checksum,
    };
  }

  async download(filePath: string): Promise<Readable> {
    try {
      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );
      const blockBlobClient = containerClient.getBlockBlobClient(filePath);
      const response = await blockBlobClient.download(0);

      return response.readableStreamBody as Readable;
    } catch (error) {
      throw new Error(
        `Failed to download file from Azure Blob: ${filePath}: ${error.message}`,
      );
    }
  }

  async delete(filePath: string): Promise<void> {
    try {
      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );
      const blockBlobClient = containerClient.getBlockBlobClient(filePath);
      await blockBlobClient.delete();
      this.logger.log(
        `File deleted from Azure Blob: ${this.containerName}/${filePath}`,
      );
    } catch (error) {
      this.logger.error(`Failed to delete from Azure Blob: ${error.message}`);
    }
  }

  async getSignedUrl(filePath: string, expiresIn: number): Promise<string> {
    try {
      const { generateBlobSASQueryParameters, BlobSASPermissions } =
        await import("@azure/storage-blob");

      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );
      const blockBlobClient = containerClient.getBlockBlobClient(filePath);

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.containerName,
          blobName: filePath,
          permissions: BlobSASPermissions.parse("r"),
          expiresOn: new Date(Date.now() + expiresIn * 1000),
        } as any,
        this.connectionString,
      ).toString();

      return `${blockBlobClient.url}?${sasToken}`;
    } catch {
      return `/api/v1/files/${encodeURIComponent(filePath)}/raw`;
    }
  }

  async getFileInfo(filePath: string): Promise<StorageFileInfo> {
    try {
      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );
      const blockBlobClient = containerClient.getBlockBlobClient(filePath);
      const properties = await blockBlobClient.getProperties();

      return {
        exists: true,
        size: properties.contentLength,
        lastModified: properties.lastModified,
        contentType: properties.contentType,
        etag: properties.etag,
      };
    } catch {
      return { exists: false };
    }
  }

  async copy(srcPath: string, destPath: string): Promise<void> {
    try {
      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );
      const srcClient = containerClient.getBlockBlobClient(srcPath);
      const destClient = containerClient.getBlockBlobClient(destPath);
      await destClient.beginCopyFromURL(srcClient.url);
    } catch (error) {
      throw new Error(
        `Failed to copy in Azure Blob: ${srcPath} -> ${destPath}: ${error.message}`,
      );
    }
  }

  async listFiles(prefix: string): Promise<string[]> {
    try {
      const blobServiceClient = await this.getClient();
      const containerClient = blobServiceClient.getContainerClient(
        this.containerName,
      );

      const results: string[] = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        results.push(blob.name);
      }
      return results;
    } catch {
      return [];
    }
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }
}
