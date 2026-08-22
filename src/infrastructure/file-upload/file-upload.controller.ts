import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
  ParseIntPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { Response } from "express";
import { FileStorageService } from "./services/file-storage.service";
import { FileCleanupService } from "./services/file-cleanup.service";
import { FileScanService } from "./services/file-scan.service";
import { FileMetadataService } from "./services/file-metadata.service";
import {
  UploadFileDto,
  UpdateFileMetadataDto,
  GenerateThumbnailDto,
  GetDownloadUrlDto,
  FileSearchDto,
  FileCleanupDto,
} from "./dto/file-upload.dto";

@ApiTags("Files")
@ApiBearerAuth()
@Controller("files")
export class FileUploadController {
  private readonly logger = new Logger(FileUploadController.name);

  constructor(
    private readonly storageService: FileStorageService,
    private readonly cleanupService: FileCleanupService,
    private readonly scanService: FileScanService,
    private readonly metadataService: FileMetadataService,
  ) {}

  // ── Upload ────────────────────────────────────────────────────────

  @Post("upload")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    }),
  )
  @ApiOperation({ summary: "Upload a file" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        storageBackend: {
          type: "string",
          enum: ["local", "s3", "azure_blob"],
        },
        tags: { type: "array", items: { type: "string" } },
        description: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "File uploaded and processed" })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    const userId = "system";
    const result = await this.storageService.upload(file, userId, dto);

    return {
      success: true,
      file: {
        id: result.file.id,
        originalName: result.file.originalName,
        mimeType: result.file.mimeType,
        size: result.file.size,
        category: result.file.category,
        status: result.file.status,
        checksum: result.file.checksum,
        storageBackend: result.file.storageBackend,
        thumbnailCount: result.thumbnails?.length || 0,
      },
    };
  }

  // ── Retrieval ─────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List user's files" })
  @ApiQuery({ name: "name", required: false })
  @ApiQuery({ name: "category", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  async listFiles(
    @Query("name") name?: string,
    @Query("category") category?: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    const userId = "system";
    const { files, total } = await this.storageService.search(
      {
        name,
        category: category as any,
        limit: limit || 20,
        offset: offset || 0,
      },
      userId,
    );

    return {
      success: true,
      total,
      files: files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        category: f.category,
        status: f.status,
        storageBackend: f.storageBackend,
        createdAt: f.createdAt,
      })),
    };
  }

  @Get("search")
  @ApiOperation({ summary: "Search files with filters" })
  async searchFiles(@Query() dto: FileSearchDto) {
    const userId = "system";
    const { files, total } = await this.storageService.search(dto, userId);

    return {
      success: true,
      total,
      files: files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        category: f.category,
        status: f.status,
        tags: f.tags,
        createdAt: f.createdAt,
      })),
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get file details" })
  @ApiParam({ name: "id" })
  async getFile(@Param("id") id: string) {
    const file = await this.storageService.getById(id);
    return { success: true, file };
  }

  // ── Download ──────────────────────────────────────────────────────

  @Get(":id/download")
  @ApiOperation({ summary: "Download file" })
  @ApiParam({ name: "id" })
  async downloadFile(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { stream, file } = await this.storageService.download(id);
    res.set({
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      "Content-Length": file.size.toString(),
    });
    stream.pipe(res);
  }

  @Get(":id/url")
  @ApiOperation({ summary: "Get a signed download URL" })
  @ApiParam({ name: "id" })
  @ApiQuery({ name: "expiresIn", required: false, description: "Seconds until URL expires" })
  async getDownloadUrl(
    @Param("id") id: string,
    @Query("expiresIn") expiresIn?: number,
  ) {
    const url = await this.storageService.getDownloadUrl(id, {
      expiresIn: expiresIn || 3600,
    });
    return { success: true, url, expiresIn: expiresIn || 3600 };
  }

  // ── Metadata ──────────────────────────────────────────────────────

  @Put(":id/metadata")
  @ApiOperation({ summary: "Update file metadata" })
  @ApiParam({ name: "id" })
  async updateMetadata(
    @Param("id") id: string,
    @Body() dto: UpdateFileMetadataDto,
  ) {
    const file = await this.storageService.updateMetadata(id, dto);
    return { success: true, file };
  }

  @Get(":id/thumbnails")
  @ApiOperation({ summary: "List thumbnails for a file" })
  @ApiParam({ name: "id" })
  async getThumbnails(@Param("id") id: string) {
    const thumbnails = await this.metadataService.getThumbnails(id);
    return { success: true, thumbnails };
  }

  @Post(":id/thumbnails")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Generate a new thumbnail" })
  @ApiParam({ name: "id" })
  async generateThumbnail(
    @Param("id") id: string,
    @Body() dto: GenerateThumbnailDto,
  ) {
    const file = await this.storageService.getById(id);
    const thumbnail = await this.metadataService.generateThumbnail(
      file,
      dto.width,
      dto.height,
      dto.format,
      dto.variant,
    );
    return { success: true, thumbnail };
  }

  // ── Scan ──────────────────────────────────────────────────────────

  @Get(":id/scan-results")
  @ApiOperation({ summary: "Get virus scan results" })
  @ApiParam({ name: "id" })
  async getScanResults(@Param("id") id: string) {
    const results = await this.scanService.getScanResults(id);
    return { success: true, results };
  }

  // ── Stats ─────────────────────────────────────────────────────────

  @Get("stats/overview")
  @ApiOperation({ summary: "Get file storage statistics" })
  async getStats() {
    const userId = "system";
    const stats = await this.storageService.getStorageStats(userId);
    return { success: true, stats };
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  @Get("cleanup/orphaned")
  @ApiOperation({ summary: "List orphaned files" })
  async getOrphanedFiles() {
    const files = await this.cleanupService.getOrphanedFiles();
    return {
      success: true,
      count: files.length,
      files: files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        size: f.size,
        createdAt: f.createdAt,
      })),
    };
  }

  @Get("cleanup/expired")
  @ApiOperation({ summary: "List expired files" })
  async getExpiredFiles() {
    const files = await this.cleanupService.getExpiredFiles();
    return {
      success: true,
      count: files.length,
      files: files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        size: f.size,
        expiresAt: f.expiresAt,
      })),
    };
  }

  @Post("cleanup/run")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Run file cleanup manually" })
  async runCleanup(@Body() dto: FileCleanupDto) {
    const result = await this.cleanupService.cleanup(dto);
    return { success: true, result };
  }

  // ── Delete ────────────────────────────────────────────────────────

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a file" })
  @ApiParam({ name: "id" })
  async deleteFile(@Param("id") id: string) {
    await this.storageService.delete(id);
    return { success: true, message: "File deleted" };
  }
}
