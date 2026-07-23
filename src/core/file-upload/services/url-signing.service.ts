import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UrlSigningService {
  private readonly logger = new Logger(UrlSigningService.name);
  private readonly defaultExpiry: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    // Get default expiry from config, default to 1 hour (3600 seconds)
    this.defaultExpiry = this.configService.get<number>('FILE_UPLOAD.DEFAULT_URL_EXPIRY', 3600);
  }

  /**
   * Generate a signed download URL for a file
   * @param fileId - Unique identifier of the file
   * @param expiresIn - Optional custom expiry time in seconds (overrides default)
   * @returns The signed URL token
   */
  generateSignedUrl(fileId: string, expiresIn?: number): { token: string; expiry: Date } {
    const now = Math.floor(Date.now() / 1000);
    const expirySeconds = expiresIn || this.defaultExpiry;
    const expiry = new Date((now + expirySeconds) * 1000);

    const payload = {
      sub: fileId,
      iat: now,
      exp: now + expirySeconds,
      type: 'download',
    };

    const token = this.jwtService.sign(payload);
    
    this.logger.log(`Generated signed URL for file ${fileId}, expires at ${expiry.toISOString()}`);
    
    return {
      token,
      expiry,
    };
  }

  /**
   * Verify a signed download URL token
   * @param token - The JWT token to verify
   * @param fileId - Expected file ID to validate against the token subject
   * @returns boolean indicating if the token is valid
   */
  verifySignedUrl(token: string, fileId: string): boolean {
    try {
      const payload = this.jwtService.verify(token);
      
      // Verify token type is for download
      if (payload.type !== 'download') {
        this.logger.warn(`Invalid token type for file ${fileId}`);
        return false;
      }

      // Verify token is for the requested file
      if (payload.sub !== fileId) {
        this.logger.warn(`Token subject mismatch for file ${fileId}. Token subject: ${payload.sub}`);
        return false;
      }

      this.logger.log(`Successfully verified signed URL token for file ${fileId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to verify token for file ${fileId}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Get the expiry timestamp from a token without verifying
   * Useful for debugging and logging
   */
  getTokenExpiry(token: string): Date | null {
    try {
      const payload = this.jwtService.decode(token);
      if (payload && typeof payload === 'object' && 'exp' in payload) {
        return new Date((payload.exp as number) * 1000);
      }
      return null;
    } catch {
      return null;
    }
  }
}