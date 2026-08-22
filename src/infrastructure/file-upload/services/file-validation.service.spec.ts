import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { FileValidationService } from "./file-validation.service";
import { FileCategory } from "../entities/uploaded-file.entity";

describe("FileValidationService", () => {
  let service: FileValidationService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        FILE_MAX_SIZE_BYTES: 1024 * 1024, // 1MB
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileValidationService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FileValidationService>(FileValidationService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("validate", () => {
    it("should accept a valid JPEG image", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "photo.jpg",
        encoding: "7bit",
        mimetype: "image/jpeg",
        size: 1024,
        destination: "",
        filename: "photo.jpg",
        path: "",
        buffer: Buffer.from([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
          // SOF0 marker to test JPEG dimension parsing
          0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        ]),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(true);
      expect(result.category).toBe(FileCategory.IMAGE);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept a valid PNG image", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "image.png",
        encoding: "7bit",
        mimetype: "image/png",
        size: 2048,
        destination: "",
        filename: "image.png",
        path: "",
        buffer: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          // IHDR chunk: width=100, height=50
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x32,
        ]),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(true);
      expect(result.category).toBe(FileCategory.IMAGE);
    });

    it("should reject empty files", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "empty.txt",
        encoding: "7bit",
        mimetype: "text/plain",
        size: 0,
        destination: "",
        filename: "empty.txt",
        path: "",
        buffer: Buffer.alloc(0),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("empty"))).toBe(true);
    });

    it("should reject files exceeding max size", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "large.bin",
        encoding: "7bit",
        mimetype: "application/octet-stream",
        size: 2 * 1024 * 1024, // 2MB > 1MB limit
        destination: "",
        filename: "large.bin",
        path: "",
        buffer: Buffer.alloc(2 * 1024 * 1024),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("exceeds maximum"))).toBe(true);
    });

    it("should reject blocked executable extensions", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "malware.exe",
        encoding: "7bit",
        mimetype: "application/x-msdownload",
        size: 1024,
        destination: "",
        filename: "malware.exe",
        path: "",
        buffer: Buffer.alloc(1024),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("blocked"))).toBe(true);
    });

    it("should detect suspicious double extensions", async () => {
      // image.exe.jpg — .exe is hidden in the middle, .jpg is the final (allowed) extension
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "image.exe.jpg",
        encoding: "7bit",
        mimetype: "image/jpeg",
        size: 1024,
        destination: "",
        filename: "image.exe.jpg",
        path: "",
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("double extension"))).toBe(true);
    });

    it("should accept text files and leave EICAR detection to the scan service", async () => {
      const eicarString =
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "test.txt",
        encoding: "7bit",
        mimetype: "text/plain",
        size: Buffer.byteLength(eicarString),
        destination: "",
        filename: "test.txt",
        path: "",
        buffer: Buffer.from(eicarString),
        stream: null,
      } as any;

      const result = await service.validate(file);
      // Validation passes; EICAR is caught by the scan service
      expect(result.valid).toBe(true);
      expect(result.category).toBe(FileCategory.DOCUMENT);
    });

    it("should respect category filtering", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "image.jpg",
        encoding: "7bit",
        mimetype: "image/jpeg",
        size: 1024,
        destination: "",
        filename: "image.jpg",
        path: "",
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        stream: null,
      } as any;

      const result = await service.validate(file, undefined, [
        FileCategory.DOCUMENT,
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("not allowed"))).toBe(true);
    });

    it("should accept valid PDF documents", async () => {
      const file: Express.Multer.File = {
        fieldname: "file",
        originalname: "document.pdf",
        encoding: "7bit",
        mimetype: "application/pdf",
        size: 4096,
        destination: "",
        filename: "document.pdf",
        path: "",
        buffer: Buffer.from([
          0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
        ]),
        stream: null,
      } as any;

      const result = await service.validate(file);
      expect(result.valid).toBe(true);
      expect(result.category).toBe(FileCategory.DOCUMENT);
    });
  });

  describe("categorizeFile", () => {
    it("should categorize image MIME types", () => {
      expect(service.categorizeFile("image/jpeg")).toBe(FileCategory.IMAGE);
      expect(service.categorizeFile("image/png")).toBe(FileCategory.IMAGE);
      expect(service.categorizeFile("image/gif")).toBe(FileCategory.IMAGE);
      expect(service.categorizeFile("image/webp")).toBe(FileCategory.IMAGE);
    });

    it("should categorize document MIME types", () => {
      expect(service.categorizeFile("application/pdf")).toBe(FileCategory.DOCUMENT);
      expect(service.categorizeFile("text/plain")).toBe(FileCategory.DOCUMENT);
      expect(
        service.categorizeFile(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBe(FileCategory.DOCUMENT);
    });

    it("should categorize video MIME types", () => {
      expect(service.categorizeFile("video/mp4")).toBe(FileCategory.VIDEO);
      expect(service.categorizeFile("video/webm")).toBe(FileCategory.VIDEO);
    });

    it("should categorize audio MIME types", () => {
      expect(service.categorizeFile("audio/mpeg")).toBe(FileCategory.AUDIO);
      expect(service.categorizeFile("audio/wav")).toBe(FileCategory.AUDIO);
    });

    it("should categorize archive MIME types", () => {
      expect(service.categorizeFile("application/zip")).toBe(FileCategory.ARCHIVE);
      expect(
        service.categorizeFile("application/x-7z-compressed"),
      ).toBe(FileCategory.ARCHIVE);
    });

    it("should return OTHER for unknown MIME types", () => {
      expect(service.categorizeFile("application/x-custom")).toBe(
        FileCategory.OTHER,
      );
    });
  });

  describe("isMimeAllowed", () => {
    it("should return true for allowed types", () => {
      expect(service.isMimeAllowed("image/jpeg")).toBe(true);
      expect(service.isMimeAllowed("application/pdf")).toBe(true);
    });

    it("should return false for disallowed types", () => {
      expect(service.isMimeAllowed("application/x-executable")).toBe(false);
      expect(service.isMimeAllowed("text/html")).toBe(false);
    });
  });

  describe("getAllowedMimeTypes", () => {
    it("should return a non-empty list of allowed types", () => {
      const types = service.getAllowedMimeTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain("image/jpeg");
      expect(types).toContain("application/pdf");
    });
  });
});
