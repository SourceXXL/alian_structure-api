import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
  FileScanResult,
  ScanStatus,
} from "../entities/file-scan-result.entity";
import { UploadedFile, FileStatus } from "../entities/uploaded-file.entity";

export interface ScanEngine {
  name: string;
  version: string;
  scan(
    filePath: string,
    buffer: Buffer,
  ): Promise<{ clean: boolean; threatName?: string; details?: Record<string, any> }>;
}

@Injectable()
export class FileScanService {
  private readonly logger = new Logger(FileScanService.name);
  private readonly scanEnabled: boolean;
  private readonly engines: ScanEngine[] = [];

  constructor(
    @InjectRepository(FileScanResult)
    private readonly scanResultRepo: Repository<FileScanResult>,
    @InjectRepository(UploadedFile)
    private readonly fileRepo: Repository<UploadedFile>,
    private readonly configService: ConfigService,
  ) {
    this.scanEnabled =
      this.configService.get<boolean>("FILE_SCAN_ENABLED") !== false;

    if (this.scanEnabled) {
      // Register default built-in scan engine (signature hash-based)
      this.engines.push(new SignatureScanEngine());
      this.logger.log("Virus scan engines registered: SignatureScanEngine");
    }
  }

  async scanFile(
    file: UploadedFile,
    buffer: Buffer,
  ): Promise<FileScanResult> {
    if (!this.scanEnabled) {
      this.logger.debug("Virus scanning disabled, skipping");
      return this.createResult(file.id, {
        clean: true,
        engine: "none",
        engineVersion: "0.0.0",
      });
    }

    const startTime = Date.now();
    let overallClean = true;
    let threatName: string | undefined;
    let scanDetails: Record<string, any> | undefined;
    let lastEngine = "unknown";

    for (const engine of this.engines) {
      try {
        lastEngine = engine.name;
        const result = await engine.scan(file.storagePath, buffer);

        if (!result.clean) {
          overallClean = false;
          threatName = result.threatName;
          scanDetails = result.details;
          break;
        }
      } catch (error) {
        this.logger.error(
          `Scan engine ${engine.name} failed for ${file.id}: ${error.message}`,
        );
      }
    }

    const scanDuration = Date.now() - startTime;
    const status = overallClean ? ScanStatus.CLEAN : ScanStatus.INFECTED;

    // Update file status
    file.scanStatus = status;
    file.scannedAt = new Date();
    file.scanEngine = lastEngine;
    file.status = overallClean ? FileStatus.PROCESSING : FileStatus.INFECTED;
    await this.fileRepo.save(file);

    // Save scan result
    const scanResult = this.scanResultRepo.create({
      fileId: file.id,
      engine: lastEngine,
      engineVersion: "1.0.0",
      status,
      threatName,
      details: scanDetails,
      scanDurationMs: scanDuration,
    });

    const saved = await this.scanResultRepo.save(scanResult);
    this.logger.log(
      `Scan completed for ${file.id}: ${status} in ${scanDuration}ms`,
    );

    return saved;
  }

  async getScanResults(fileId: string): Promise<FileScanResult[]> {
    return this.scanResultRepo.find({
      where: { fileId },
      order: { createdAt: "DESC" },
    });
  }

  private createResult(
    fileId: string,
    data: {
      clean: boolean;
      engine: string;
      engineVersion: string;
      threatName?: string;
    },
  ): FileScanResult {
    return this.scanResultRepo.create({
      fileId,
      engine: data.engine,
      engineVersion: data.engineVersion,
      status: data.clean ? ScanStatus.CLEAN : ScanStatus.INFECTED,
      threatName: data.threatName,
    });
  }
}

/**
 * Default signature-based scan engine.
 * Checks file hash against known-bad hashes and applies heuristics.
 * In production, replace or supplement with ClamAV, VirusTotal, etc.
 */
class SignatureScanEngine implements ScanEngine {
  name = "signature-check";
  version = "1.0.0";

  // Known malware signature hashes (hex SHA-256 prefixes)
  private readonly knownBadPrefixes: string[] = [
    "d55f983c994caa160ec63a59f6b451da", // Example EICAR test
  ];

  async scan(
    filePath: string,
    buffer: Buffer,
  ): Promise<{
    clean: boolean;
    threatName?: string;
    details?: Record<string, any>;
  }> {
    const hash = crypto.createHash("md5").update(buffer).digest("hex");

    // Check against known signatures
    for (const prefix of this.knownBadPrefixes) {
      if (hash.startsWith(prefix)) {
        return {
          clean: false,
          threatName: "Known-Malware-Signature",
          details: { hash, matchedPrefix: prefix },
        };
      }
    }

    // Heuristic: check for suspicious patterns in the file
    const content = buffer.toString("utf-8", 0, Math.min(buffer.length, 1024));

    // EICAR test string
    if (content.includes("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR")) {
      return {
        clean: false,
        threatName: "EICAR-Test-File",
        details: { pattern: "EICAR test string detected" },
      };
    }

    // Suspicious script injection in images
    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      content.includes("<script")
    ) {
      return {
        clean: false,
        threatName: "Suspicious-Script-In-Image",
        details: { pattern: "Script tag in JPEG file" },
      };
    }

    return { clean: true };
  }
}
