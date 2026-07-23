import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, unlinkSync } from 'fs';

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
  orientation: number;
  exif: Record<string, any>;
  colorSpace: string;
  density: number;
}

export interface ThumbnailConfig {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}

export interface ProcessedImage {
  buffer: Buffer;
  metadata: ImageMetadata;
  hash: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

@Injectable()
export class ImageProcessingService {
  private readonly defaultQuality: number;
  private readonly maxImageDimension: number;
  private readonly enableWebP: boolean;
  private readonly thumbnails: ThumbnailConfig[];
  private readonly sharp: typeof sharp;

  constructor(private readonly configService: ConfigService) {
    this.sharp = sharp;
    
    // Configuration
    this.defaultQuality = this.configService.get<number>(
      'IMAGE_COMPRESSION_QUALITY',
      80,
    );
    this.maxImageDimension = this.configService.get<number>(
      'MAX_IMAGE_DIMENSION',
      4096,
    );
    this.enableWebP = this.configService.get<boolean>('ENABLE_WEBP', true);
    this.thumbnails = this.getDefaultThumbnailConfigs();
  }

  /**
   * Process an image: optimize, resize, and generate metadata
   */
  async processImage(
    buffer: Buffer,
    options?: {
      quality?: number;
      format?: 'jpeg' | 'png' | 'webp';
      resize?: { width?: number; height?: number };
    },
  ): Promise<ProcessedImage> {
    const startTime = Date.now();
    const originalSize = buffer.length;
    
    // Get image metadata first
    const metadata = await this.extractMetadata(buffer);
    
    // Create sharp instance
    let image = this.sharp(buffer);
    
    // Resize if dimensions exceed maximum or specific dimensions requested
    if (options?.resize?.width || options?.resize?.height) {
      image = image.resize({
        width: options.resize.width,
        height: options.resize.height,
        fit: 'inside',
        withoutEnlargement: true,
      });
    } else if (metadata.width > this.maxImageDimension || metadata.height > this.maxImageDimension) {
      image = image.resize({
        width: this.maxImageDimension,
        height: this.maxImageDimension,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Apply output format and quality
    const outputFormat = options?.format || (this.enableWebP ? 'webp' : metadata.format as 'jpeg' | 'png');
    const quality = options?.quality || this.defaultQuality;

    switch (outputFormat) {
      case 'webp':
        image = image.webp({ quality, effort: 6 });
        break;
      case 'jpeg':
        image = image.jpeg({ quality, mozjpeg: true });
        break;
      case 'png':
        image = image.png({ quality, compressionLevel: 9 });
        break;
    }

    // Process the image
    const processedBuffer = await image.toBuffer();
    const compressedSize = processedBuffer.length;
    
    // Calculate hash
    const hash = createHash('sha256').update(processedBuffer).digest('hex');

    return {
      buffer: processedBuffer,
      metadata: {
        ...metadata,
        format: outputFormat,
        size: compressedSize,
      },
      hash,
      originalSize,
      compressedSize,
      compressionRatio: 1 - (compressedSize / originalSize),
    };
  }

  /**
   * Generate thumbnail images from original image
   */
  async generateThumbnails(
    buffer: Buffer,
    customConfigs?: ThumbnailConfig[],
  ): Promise<Map<string, Buffer>> {
    const thumbnailBuffers = new Map<string, Buffer>();
    const configs = customConfigs || this.thumbnails;

    for (const config of configs) {
      try {
        const thumbnail = await this.sharp(buffer)
          .resize(config.width, config.height, {
            fit: config.fit,
            position: 'centre',
          })
          [config.format]({ quality: config.quality })
          .toBuffer();
          
        const key = `${config.width}x${config.height}_${config.format}`;
        thumbnailBuffers.set(key, thumbnail);
      } catch (error) {
        console.error(`Failed to generate thumbnail ${config.width}x${config.height}:`, error);
      }
    }

    return thumbnailBuffers;
  }

  /**
   * Extract comprehensive metadata from an image
   */
  async extractMetadata(buffer: Buffer): Promise<ImageMetadata> {
    const metadata = await this.sharp(buffer).metadata();
    
    // Extract EXIF data if available
    let exif: Record<string, any> = {};
    if (metadata.exif) {
      try {
        exif = this.parseExifData(metadata.exif);
      } catch {
        // Ignore EXIF parsing errors
      }
    }

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: metadata.size || 0,
      hasAlpha: metadata.hasAlpha || false,
      orientation: metadata.orientation || 1,
      exif,
      colorSpace: metadata.space || 'unknown',
      density: metadata.density || 72,
    };
  }

  /**
   * Simple EXIF parser (basic implementation)
   */
  private parseExifData(exifBuffer: Buffer): Record<string, any> {
    const exif: Record<string, any> = {};
    
    // This is a simplified parser - in production you'd use exifreader or similar
    // For now, we'll just extract some basic EXIF tags that are commonly present
    
    // In a real implementation, you'd use:
    // import { parse } from 'exifreader';
    // const tags = parse(exifBuffer);
    // return tags;
    
    return exif;
  }

  /**
   * Get default thumbnail configurations
   */
  private getDefaultThumbnailConfigs(): ThumbnailConfig[] {
    return [
      { width: 100, height: 100, format: 'webp', quality: 80, fit: 'cover' }, // Avatar
      { width: 320, height: 240, format: 'webp', quality: 80, fit: 'inside' }, // Small preview
      { width: 640, height: 480, format: 'webp', quality: 85, fit: 'inside' }, // Medium preview
      { width: 1280, height: 720, format: 'webp', quality: 90, fit: 'inside' }, // HD preview
    ];
  }

  /**
   * Add watermark to an image
   */
  async addWatermark(
    imageBuffer: Buffer,
    watermarkBuffer: Buffer,
    position: 'center' | 'bottom-right' | 'bottom-left' = 'bottom-right',
    opacity: number = 0.5,
  ): Promise<Buffer> {
    const imageMetadata = await this.extractMetadata(imageBuffer);
    const watermarkMetadata = await this.extractMetadata(watermarkBuffer);
    
    // Calculate position
    let left = 0;
    let top = 0;
    
    switch (position) {
      case 'center':
        left = (imageMetadata.width - watermarkMetadata.width) / 2;
        top = (imageMetadata.height - watermarkMetadata.height) / 2;
        break;
      case 'bottom-right':
        left = imageMetadata.width - watermarkMetadata.width - 20; // 20px padding
        top = imageMetadata.height - watermarkMetadata.height - 20;
        break;
      case 'bottom-left':
        left = 20;
        top = imageMetadata.height - watermarkMetadata.height - 20;
        break;
    }

    return this.sharp(imageBuffer)
      .composite([{
        input: watermarkBuffer,
        left: Math.round(left),
        top: Math.round(top),
        blend: 'over',
      }])
      .toBuffer();
  }

  /**
   * Convert image to grayscale
   */
  async convertToGrayscale(buffer: Buffer): Promise<Buffer> {
    return this.sharp(buffer).grayscale().toBuffer();
  }

  /**
   * Rotate image by specified degrees
   */
  async rotateImage(buffer: Buffer, degrees: number): Promise<Buffer> {
    return this.sharp(buffer).rotate(degrees).toBuffer();
  }

  /**
   * Flip image horizontally or vertically
   */
  async flipImage(buffer: Buffer, horizontal: boolean = true): Promise<Buffer> {
    if (horizontal) {
      return this.sharp(buffer).flop().toBuffer();
    }
    return this.sharp(buffer).flip().toBuffer();
  }

  /**
   * Get image processing statistics
   */
  getStats() {
    return {
      defaultQuality: this.defaultQuality,
      maxImageDimension: this.maxImageDimension,
      enableWebP: this.enableWebP,
      configuredThumbnails: this.thumbnails.length,
    };
  }
}