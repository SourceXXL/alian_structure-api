import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, unlink } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';

const unlinkAsync = promisify(unlink);

export interface ScanResult {
  infected: boolean;
  threats: string[];
  scanDuration: number;
  scanner: string;
  scanDate: Date;
  rawOutput: string;
}

export enum ScanStatus {
  PENDING = 'pending',
  SCANNING = 'scanning',
  CLEAN = 'clean',
  INFECTED = 'infected',
  FAILED = 'failed',
}

@Injectable()
export class VirusScannerService {
  private readonly enabled: boolean;
  private readonly scannerPath: string;
  private readonly quarantinePath: string;
  private readonly scanTimeout: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('ENABLE_VIRUS_SCANNING', false);
    this.scannerPath = this.configService.get<string>(
      'CLAMAV_PATH',
      '/usr/bin/clamscan',
    );
    this.quarantinePath = this.configService.get<string>(
      'QUARANTINE_PATH',
      './quarantine',
    );
    this.scanTimeout = this.configService.get<number>('SCAN_TIMEOUT', 30000); // 30 seconds
  }

  /**
   * Scan a file buffer for viruses/malware
   */
  async scanFile(fileBuffer: Buffer, filename: string): Promise<ScanResult> {
    const startTime = Date.now();
    const threats: string[] = [];
    let rawOutput = '';

    if (!this.enabled) {
      // Scanning is disabled, return clean result
      return {
        infected: false,
        threats: [],
        scanDuration: 0,
        scanner: 'none',
        scanDate: new Date(),
        rawOutput: 'Virus scanning disabled',
      };
    }

    // Create temporary file for scanning
    const tempPath = join(tmpdir(), `scan_${Date.now()}_${filename}`);
    
    try {
      // Write buffer to temporary file
      await this.writeTempFile(fileBuffer, tempPath);
      
      // Run virus scanner
      const scanOutput = await this.runScanner(tempPath);
      rawOutput = scanOutput;

      // Parse scan results
      if (scanOutput.includes('FOUND')) {
        // Extract threats from output
        const foundMatches = scanOutput.match(/(.+): (.+) FOUND/g);
        if (foundMatches) {
          foundMatches.forEach((match) => {
            const parts = match.split(': ');
            if (parts.length >= 2) {
              threats.push(parts[1].replace(' FOUND', ''));
            }
          });
        }
      }
    } catch (error) {
      throw new AppException(
        ErrorCodes.VIRUS_SCAN_FAILED,
        `Virus scanning failed: ${(error as Error).message}`,
      );
    } finally {
      // Clean up temporary file
      try {
        await unlinkAsync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      infected: threats.length > 0,
      threats,
      scanDuration: Date.now() - startTime,
      scanner: 'clamav',
      scanDate: new Date(),
      rawOutput,
    };
  }

  /**
   * Scan a file stream
   */
  async scanStream(stream: NodeJS.ReadableStream, filename: string): Promise<ScanResult> {
    // Convert stream to buffer for scanning
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    return this.scanFile(buffer, filename);
  }

  /**
   * Write buffer to temporary file
   */
  private async writeTempFile(buffer: Buffer, path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(path);
      writeStream.write(buffer);
      writeStream.end();
      
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  }

  /**
   * Run the virus scanner on a file
   */
  private async runScanner(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const scanProcess = spawn(this.scannerPath, [filePath]);
      
      let output = '';
      let errorOutput = '';

      scanProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      scanProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      const timeout = setTimeout(() => {
        scanProcess.kill();
        reject(new Error(`Scan timed out after ${this.scanTimeout}ms`));
      }, this.scanTimeout);

      scanProcess.on('close', (code) => {
        clearTimeout(timeout);
        
        // ClamAV returns 0 for clean, 1 for infected, >1 for errors
        if (code === 0 || code === 1) {
          resolve(output);
        } else {
          reject(new Error(`Scanner failed with code ${code}: ${errorOutput}`));
        }
      });

      scanProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Move infected file to quarantine
   */
  async quarantineFile(filePath: string, threatName: string): Promise<void> {
    const { mkdir, copyFile, unlink } = require('fs/promises');
    await mkdir(this.quarantinePath, { recursive: true });
    
    const quarantineFileName = `${Date.now()}_${threatName.replace(/\s+/g, '_')}`;
    const quarantinePath = join(this.quarantinePath, quarantineFileName);
    
    await copyFile(filePath, quarantinePath);
    await unlink(filePath);
  }

  /**
   * Check if scanning is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get scanner information
   */
  getScannerInfo(): { enabled: boolean; scanner: string; quarantinePath: string } {
    return {
      enabled: this.enabled,
      scanner: this.scannerPath,
      quarantinePath: this.quarantinePath,
    };
  }
}