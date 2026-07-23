import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';

const pipelineAsync = promisify(pipeline);

export interface EncryptionResult {
  encryptedBuffer: Buffer;
  iv: string;
  key: string;
  tag?: string;
  algorithm: string;
  originalSize: number;
  encryptedSize: number;
}

export interface DecryptionResult {
  decryptedBuffer: Buffer;
  originalSize: number;
  decryptedSize: number;
  verified: boolean;
}

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 32 bytes for AES-256
  private readonly ivLength = 16; // 16 bytes IV for GCM
  private readonly tagLength = 16; // 16 bytes authentication tag
  private readonly masterKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const masterKeyString = this.configService.get<string>('ENCRYPTION_MASTER_KEY');
    if (!masterKeyString) {
      throw new AppException(
        ErrorCodes.ENCRYPTION_KEY_MISSING,
        'Encryption master key is not configured',
      );
    }
    
    // Derive a proper 32-byte key from the master key string using SHA-256
    this.masterKey = createHash('sha256').update(masterKeyString).digest();
    
    if (this.masterKey.length !== this.keyLength) {
      throw new AppException(
        ErrorCodes.INVALID_ENCRYPTION_KEY,
        `Encryption key must be ${this.keyLength} bytes after derivation`,
      );
    }
  }

  /**
   * Encrypt a buffer with AES-256-GCM
   */
  async encrypt(buffer: Buffer): Promise<EncryptionResult> {
    // Generate random IV
    const iv = randomBytes(this.ivLength);
    
    // Create cipher
    const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
    
    // Encrypt the data
    const encryptedBuffer = Buffer.concat([
      cipher.update(buffer),
      cipher.final(),
    ]);
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    return {
      encryptedBuffer: Buffer.concat([encryptedBuffer, authTag]),
      iv: iv.toString('hex'),
      key: this.masterKey.toString('hex'), // In production, never return the actual key! This is for demo only
      tag: authTag.toString('hex'),
      algorithm: this.algorithm,
      originalSize: buffer.length,
      encryptedSize: encryptedBuffer.length + authTag.length,
    };
  }

  /**
   * Decrypt a buffer that was encrypted with AES-256-GCM
   */
  async decrypt(
    encryptedBuffer: Buffer,
    ivHex: string,
    tagHex: string,
  ): Promise<DecryptionResult> {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    
    if (iv.length !== this.ivLength) {
      throw new AppException(ErrorCodes.INVALID_IV_LENGTH, 'Invalid IV length');
    }
    
    if (authTag.length !== this.tagLength) {
      throw new AppException(ErrorCodes.INVALID_TAG_LENGTH, 'Invalid authentication tag length');
    }

    // Split the encrypted buffer to separate data and auth tag
    const actualEncryptedData = encryptedBuffer.slice(0, encryptedBuffer.length - this.tagLength);
    
    // Create decipher
    const decipher = createDecipheriv(this.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    
    try {
      // Decrypt the data
      const decryptedBuffer = Buffer.concat([
        decipher.update(actualEncryptedData),
        decipher.final(),
      ]);
      
      return {
        decryptedBuffer,
        originalSize: encryptedBuffer.length,
        decryptedSize: decryptedBuffer.length,
        verified: true,
      };
    } catch (error) {
      throw new AppException(
        ErrorCodes.DECRYPTION_FAILED,
        'Failed to decrypt data: authentication failed',
      );
    }
  }

  /**
   * Stream-based encryption for large files
   */
  async encryptStream(
    readStream: NodeJS.ReadableStream,
    outputPath: string,
  ): Promise<{ iv: string; tag: string }> {
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
    const writeStream = createWriteStream(outputPath);
    
    await pipelineAsync(readStream, cipher, writeStream);
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      tag: authTag.toString('hex'),
    };
  }

  /**
   * Stream-based decryption for large files
   */
  async decryptStream(
    readStream: NodeJS.ReadableStream,
    outputPath: string,
    ivHex: string,
    tagHex: string,
  ): Promise<void> {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    
    const decipher = createDecipheriv(this.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    
    const writeStream = createWriteStream(outputPath);
    
    try {
      await pipelineAsync(readStream, decipher, writeStream);
    } catch (error) {
      throw new AppException(
        ErrorCodes.STREAM_DECRYPTION_FAILED,
        'Stream decryption failed: data may be corrupted',
      );
    }
  }

  /**
   * Generate a data encryption key (DEK) for envelope encryption
   */
  generateDataEncryptionKey(): { encrypted: string; plaintext: string } {
    const dek = randomBytes(this.keyLength);
    // Encrypt DEK with master key for storage
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
    
    const encryptedDek = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    return {
      plaintext: dek.toString('hex'),
      encrypted: Buffer.concat([iv, encryptedDek, authTag]).toString('hex'),
    };
  }

  /**
   * Decrypt a data encryption key (DEK)
   */
  decryptDataEncryptionKey(encryptedDekHex: string): string {
    const encryptedDek = Buffer.from(encryptedDekHex, 'hex');
    
    // Extract IV, encrypted data, and auth tag
    const iv = encryptedDek.slice(0, this.ivLength);
    const authTag = encryptedDek.slice(-this.tagLength);
    const actualData = encryptedDek.slice(this.ivLength, -this.tagLength);
    
    const decipher = createDecipheriv(this.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    
    const dek = Buffer.concat([decipher.update(actualData), decipher.final()]);
    return dek.toString('hex');
  }

  /**
   * Calculate HMAC for a buffer for integrity verification
   */
  calculateHMAC(buffer: Buffer): string {
    const hmac = createHash('sha256');
    hmac.update(Buffer.concat([this.masterKey, buffer]));
    return hmac.digest('hex');
  }

  /**
   * Verify HMAC of a buffer
   */
  verifyHMAC(buffer: Buffer, hmacToVerify: string): boolean {
    const calculatedHmac = this.calculateHMAC(buffer);
    return crypto.timingSafeEqual(
      Buffer.from(calculatedHmac, 'hex'),
      Buffer.from(hmacToVerify, 'hex'),
    );
  }

  /**
   * Get encryption configuration information
   */
  getEncryptionInfo() {
    return {
      algorithm: this.algorithm,
      keyLength: this.keyLength,
      ivLength: this.ivLength,
      tagLength: this.tagLength,
      masterKeyConfigured: !!this.masterKey,
    };
  }
}