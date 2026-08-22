import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsObject,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  FileStorageBackend,
  FileCategory,
} from "../entities/uploaded-file.entity";

export class UploadFileDto {
  @ApiPropertyOptional({
    example: "profile-photo.jpg",
    description: "Original file name",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @ApiPropertyOptional({
    enum: FileStorageBackend,
    default: FileStorageBackend.LOCAL,
    description: "Storage backend to use",
  })
  @IsOptional()
  @IsEnum(FileStorageBackend)
  storageBackend?: FileStorageBackend;

  @ApiPropertyOptional({
    example: ["profile", "avatar"],
    description: "Tags to associate with the file",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: "User profile photo" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiPropertyOptional({
    description: "Make file publicly accessible",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: "Expiry time in seconds from now",
    example: 3600,
  })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(31536000)
  expiresIn?: number;
}

export class UpdateFileMetadataDto {
  @ApiPropertyOptional({
    example: ["profile", "updated"],
    description: "Tags to associate with the file",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: "Updated description" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiPropertyOptional({ example: { key: "value" } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class GenerateThumbnailDto {
  @ApiProperty({ example: 200, description: "Thumbnail width in pixels" })
  @IsInt()
  @Min(16)
  @Max(2048)
  width: number;

  @ApiProperty({ example: 200, description: "Thumbnail height in pixels" })
  @IsInt()
  @Min(16)
  @Max(2048)
  height: number;

  @ApiPropertyOptional({
    example: "webp",
    default: "webp",
    description: "Output format",
  })
  @IsOptional()
  @IsString()
  format?: string;

  @ApiPropertyOptional({
    example: "thumb-large",
    description: "Variant name for the thumbnail",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  variant?: string;
}

export class GetDownloadUrlDto {
  @ApiPropertyOptional({
    example: 3600,
    default: 3600,
    description: "URL expiry in seconds",
  })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(86400)
  expiresIn?: number;
}

export class FileSearchDto {
  @ApiPropertyOptional({ example: "profile" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: FileCategory })
  @IsOptional()
  @IsEnum(FileCategory)
  category?: FileCategory;

  @ApiPropertyOptional({ example: ["profile", "avatar"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 1024000, description: "Max size in bytes" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxSize?: number;

  @ApiPropertyOptional({ example: 1024, description: "Min size in bytes" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSize?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class FileCleanupDto {
  @ApiPropertyOptional({
    example: 86400,
    description: "Delete files older than this many seconds",
    default: 86400,
  })
  @IsOptional()
  @IsNumber()
  @Min(60)
  olderThanSeconds?: number;

  @ApiPropertyOptional({
    description: "Only clean up files for this user",
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: "Dry run - return what would be deleted without deleting",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
