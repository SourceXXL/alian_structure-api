import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Readable } from "stream";
import {
  StorageBackend,
  StorageUploadResult,
  StorageFileInfo,
} from "./storage-backend.interface";

@Injectable()
export class LocalStorageBackend implements StorageBackend {
  private readonly logger = new Logger(LocalStorageBackend.name);
  private readonly basePath: string;

  constructor(private readonly configService: ConfigService) {
    this.basePath =
      this.configService.get<string>("FILE_STORAGE_LOCAL_PATH") ||
      path.join(process.cwd(), "uploads");
    this.ensureDirectoryExists(this.basePath);
  }

  async upload(
    file: Buffer | Readable,
    filePath: string,
    contentType: string,
  ): Promise<StorageUploadResult> {
    const fullPath = path.join(this.basePath, filePath);
    this.ensureDirectoryExists(path.dirname(fullPath));

    let buffer: Buffer;
    if (Buffer.isBuffer(file)) {
      buffer = file;
    } else {
      buffer = await this.streamToBuffer(file);
    }

    fs.writeFileSync(fullPath, buffer);
    const checksum = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    this.logger.log(`File uploaded to local storage: ${filePath}`);

    return {
      path: filePath,
      size: buffer.length,
      checksum,
    };
  }

  async download(filePath: string): Promise<Readable> {
    const fullPath = path.join(this.basePath, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const stream = fs.createReadStream(fullPath);
    return stream;
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      this.logger.log(`File deleted from local storage: ${filePath}`);
    }
  }

  async getSignedUrl(filePath: string, expiresIn: number): Promise<string> {
    // For local storage, return a direct API endpoint URL
    return `/api/v1/files/${encodeURIComponent(filePath)}/raw`;
  }

  async getFileInfo(filePath: string): Promise<StorageFileInfo> {
    const fullPath = path.join(this.basePath, filePath);
    if (!fs.existsSync(fullPath)) {
      return { exists: false };
    }
    const stat = fs.statSync(fullPath);
    return {
      exists: true,
      size: stat.size,
      lastModified: stat.mtime,
    };
  }

  async copy(srcPath: string, destPath: string): Promise<void> {
    const src = path.join(this.basePath, srcPath);
    const dest = path.join(this.basePath, destPath);
    this.ensureDirectoryExists(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }

  async listFiles(prefix: string): Promise<string[]> {
    const dirPath = path.join(this.basePath, prefix);
    if (!fs.existsSync(dirPath)) return [];
    return this.walkDir(dirPath, this.basePath);
  }

  private walkDir(dir: string, basePath: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDir(fullPath, basePath));
      } else {
        results.push(path.relative(basePath, fullPath));
      }
    }
    return results;
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
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
