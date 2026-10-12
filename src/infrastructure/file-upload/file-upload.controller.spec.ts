import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileUploadController } from "./file-upload.controller";
import { FileStorageService } from "./services/file-storage.service";
import { FileCleanupService } from "./services/file-cleanup.service";
import { FileScanService } from "./services/file-scan.service";
import { FileMetadataService } from "./services/file-metadata.service";

/**
 * The upload MIME allowlist had no coverage at all, which is part of why the
 * `fileFilter` problem went unnoticed: the check lived in a decorator
 * expression, so it was neither reached by a test nor reliably invoked at
 * runtime. It is now enforced in `uploadFile()`, which is what these exercise.
 */
describe("FileUploadController upload allowlist", () => {
  let controller: FileUploadController;
  let storageService: { upload: jest.Mock };
  let configService: { get: jest.Mock };

  const uploadedFile = (mimetype: string) =>
    ({
      originalname: "upload",
      mimetype,
      size: 10,
      buffer: Buffer.from("data"),
    }) as unknown as Express.Multer.File;

  const user = { id: "user-1" } as never;
  const dto = {} as never;

  beforeEach(async () => {
    jest.clearAllMocks();

    storageService = { upload: jest.fn().mockResolvedValue({ file: {}, thumbnails: [] }) };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileUploadController],
      providers: [
        { provide: FileStorageService, useValue: storageService },
        { provide: FileCleanupService, useValue: {} },
        { provide: FileScanService, useValue: {} },
        { provide: FileMetadataService, useValue: {} },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<FileUploadController>(FileUploadController);
  });

  describe("default allowlist (FILE_ALLOWED_MIME_TYPES unset)", () => {
    it("accepts an allowed mime type", async () => {
      await expect(
        controller.uploadFile(uploadedFile("image/png"), dto, user),
      ).resolves.toBeDefined();
      expect(storageService.upload).toHaveBeenCalled();
    });

    it("rejects a mime type that is not on the allowlist", async () => {
      await expect(
        controller.uploadFile(uploadedFile("application/x-msdownload"), dto, user),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.upload).not.toHaveBeenCalled();
    });

    it("rejects a request with no file", async () => {
      await expect(
        controller.uploadFile(undefined as never, dto, user),
      ).rejects.toThrow("No file provided");
      expect(storageService.upload).not.toHaveBeenCalled();
    });
  });

  describe("configured allowlist (FILE_ALLOWED_MIME_TYPES set)", () => {
    it("honours the configured list instead of the default", async () => {
      configService.get.mockReturnValue("text/plain, application/json");

      await expect(
        controller.uploadFile(uploadedFile("text/plain"), dto, user),
      ).resolves.toBeDefined();

      // On the default list, but not on the configured one.
      await expect(
        controller.uploadFile(uploadedFile("image/png"), dto, user),
      ).rejects.toThrow(BadRequestException);
    });

    it("falls back to the default list when the configured value is only separators", async () => {
      configService.get.mockReturnValue(" , ,");

      await expect(
        controller.uploadFile(uploadedFile("image/png"), dto, user),
      ).resolves.toBeDefined();
    });
  });

  it("rejects before touching storage when the user is unknown", async () => {
    await expect(
      controller.uploadFile(uploadedFile("image/png"), dto, undefined as never),
    ).rejects.toThrow("User identity not found");
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});