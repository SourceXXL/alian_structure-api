import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { fromBuffer } from 'file-type';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as exifr from 'exifr';
import { createHash } from 'crypto';

export interface ExtractedMetadata {
  exif?: Record<string, any>;
  text?: string;
  keywords: string[];
  language?: string;
  pageCount?: number;
  author?: string;
  title?: string;
  subject?: string;
  creationDate?: Date;
  modificationDate?: Date;
  hash: string;
  size: number;
  fileType: string;
  mimeType: string;
  additional: Record<string, any>;
  searchVector?: string;
}

@Injectable()
export class MetadataExtractorService {
  constructor() {}

  /**
   * Extract comprehensive metadata from any file type
   */
  async extractAll(buffer: Buffer, filename: string): Promise<ExtractedMetadata> {
    const fileType = await fromBuffer(buffer);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const mimeType = fileType?.mime || 'application/octet-stream';
    const extension = fileType?.ext || this.getExtension(filename);

    // Base metadata
    const metadata: ExtractedMetadata = {
      hash,
      size: buffer.length,
      fileType: extension,
      mimeType,
      keywords: [],
      additional: {},
    };

    // Extract type-specific metadata
    try {
      if (this.isImage(mimeType)) {
        await this.extractImageMetadata(buffer, metadata);
      } else if (mimeType === 'application/pdf') {
        await this.extractPdfMetadata(buffer, metadata);
      } else if (this.isWordDocument(mimeType)) {
        await this.extractWordMetadata(buffer, metadata);
      } else if (this.isSpreadsheet(mimeType)) {
        await this.extractSpreadsheetMetadata(buffer, metadata);
      } else if (this.isTextFile(mimeType)) {
        await this.extractTextMetadata(buffer, metadata);
      }
    } catch (error) {
      console.error('Metadata extraction error:', error);
      // Continue with partial metadata even if extraction fails
    }

    // Generate search vector from extracted text and metadata
    metadata.searchVector = this.generateSearchVector(metadata);
    
    return metadata;
  }

  /**
   * Extract metadata from image files
   */
  private async extractImageMetadata(buffer: Buffer, metadata: ExtractedMetadata): Promise<void> {
    try {
      const exif = await exifr.parse(buffer, {
        // Parse all EXIF tags
        gps: true,
        exif: true,
        iptc: true,
        xmp: true,
      });

      if (exif) {
        metadata.exif = exif;
        metadata.creationDate = exif.CreateDate || exif.DateTimeOriginal;
        metadata.modificationDate = exif.ModifyDate;
        metadata.author = exif.Artist || exif.Creator;
        metadata.title = exif.ImageDescription || exif.Title;

        // Extract keywords from IPTC
        if (exif.Keywords) {
          metadata.keywords = Array.isArray(exif.Keywords) ? exif.Keywords : [exif.Keywords];
        }
      }
    } catch (error) {
      console.warn('Image EXIF extraction failed:', error);
    }
  }

  /**
   * Extract metadata from PDF files
   */
  private async extractPdfMetadata(buffer: Buffer, metadata: ExtractedMetadata): Promise<void> {
    try {
      const pdfData = await pdfParse(buffer);
      
      metadata.text = pdfData.text;
      metadata.pageCount = pdfData.numpages;
      metadata.title = pdfData.info?.Title;
      metadata.author = pdfData.info?.Author;
      metadata.subject = pdfData.info?.Subject;
      metadata.creationDate = pdfData.info?.CreationDate ? new Date(pdfData.info.CreationDate) : undefined;
      metadata.modificationDate = pdfData.info?.ModDate ? new Date(pdfData.info.ModDate) : undefined;

      // Extract keywords from PDF info
      if (pdfData.info?.Keywords) {
        metadata.keywords = pdfData.info.Keywords.split(/[,;]\s*/);
      }
    } catch (error) {
      console.warn('PDF metadata extraction failed:', error);
    }
  }

  /**
   * Extract metadata from Word documents (docx)
   */
  private async extractWordMetadata(buffer: Buffer, metadata: ExtractedMetadata): Promise<void> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      metadata.text = result.value;
      
      // Basic metadata extraction from document properties
      // For more comprehensive metadata, we'd need a library like docxtemplater or similar
      metadata.additional.wordProcessing = true;
    } catch (error) {
      console.warn('Word document metadata extraction failed:', error);
    }
  }

  /**
   * Extract metadata from spreadsheet files
   */
  private async extractSpreadsheetMetadata(buffer: Buffer, metadata: ExtractedMetadata): Promise<void> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      
      // Extract sheet names and basic info
      metadata.additional.sheets = workbook.SheetNames;
      metadata.pageCount = workbook.SheetNames.length;
      
      // Extract cell data as text for searchability
      let fullText = '';
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        json.forEach((row: any) => {
          fullText += row.join(' ') + ' ';
        });
      });
      
      metadata.text = fullText;
    } catch (error) {
      console.warn('Spreadsheet metadata extraction failed:', error);
    }
  }

  /**
   * Extract metadata from plain text files
   */
  private async extractTextMetadata(buffer: Buffer, metadata: ExtractedMetadata): Promise<void> {
    try {
      metadata.text = buffer.toString('utf8');
      
      // Basic language detection (simplified)
      // In production you'd use a proper language detection library like franc
      if (metadata.text) {
        const charCount = metadata.text.length;
        const wordCount = metadata.text.split(/\s+/).length;
        metadata.additional = {
          charCount,
          wordCount,
          lineCount: metadata.text.split('\n').length,
        };
      }
    } catch (error) {
      console.warn('Text file metadata extraction failed:', error);
    }
  }

  /**
   * Generate a searchable text vector from all extracted metadata
   */
  private generateSearchVector(metadata: ExtractedMetadata): string {
    const parts: string[] = [];
    
    if (metadata.title) parts.push(metadata.title);
    if (metadata.subject) parts.push(metadata.subject);
    if (metadata.author) parts.push(metadata.author);
    if (metadata.text) parts.push(metadata.text.substring(0, 10000)); // Limit size
    if (metadata.keywords?.length) parts.push(metadata.keywords.join(' '));
    
    // Add exif metadata if available
    if (metadata.exif) {
      Object.values(metadata.exif).forEach((value) => {
        if (typeof value === 'string' || typeof value === 'number') {
          parts.push(String(value));
        }
      });
    }

    return parts.join(' ').toLowerCase().replace(/[^\w\s]/g, '');
  }

  /**
   * Check if MIME type is an image
   */
  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  /**
   * Check if MIME type is a Word document
   */
  private isWordDocument(mimeType: string): boolean {
    return [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ].includes(mimeType);
  }

  /**
   * Check if MIME type is a spreadsheet
   */
  private isSpreadsheet(mimeType: string): boolean {
    return [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ].includes(mimeType);
  }

  /**
   * Check if MIME type is a text file
   */
  private isTextFile(mimeType: string): boolean {
    return [
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/json',
      'text/xml',
    ].includes(mimeType);
  }

  /**
   * Get file extension from filename
   */
  private getExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown';
  }

  /**
   * Extract text content from a file for search indexing
   */
  async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    const metadata: ExtractedMetadata = {
      hash: '',
      size: buffer.length,
      fileType: '',
      mimeType,
      keywords: [],
      additional: {},
    };

    try {
      if (mimeType === 'application/pdf') {
        await this.extractPdfMetadata(buffer, metadata);
      } else if (this.isWordDocument(mimeType)) {
        await this.extractWordMetadata(buffer, metadata);
      } else if (this.isSpreadsheet(mimeType)) {
        await this.extractSpreadsheetMetadata(buffer, metadata);
      } else if (this.isTextFile(mimeType)) {
        await this.extractTextMetadata(buffer, metadata);
      }
    } catch {
      // Fallback to basic text extraction
      return buffer.toString('utf8').substring(0, 50000);
    }

    return metadata.text || '';
  }
}