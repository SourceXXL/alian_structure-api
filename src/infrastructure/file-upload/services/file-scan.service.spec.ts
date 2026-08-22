import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { FileScanService } from "./file-scan.service";
import { FileScanResult, ScanStatus } from "../entities/file-scan-result.entity";
import { UploadedFile, FileStatus } from "../entities/uploaded-file.entity";

describe("FileScanService", () => {
  let service: FileScanService;

  const mockScanResultRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockFileRepo = {
    save: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        FILE_SCAN_ENABLED: true,
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileScanService,
        {
          provide: getRepositoryToken(FileScanResult),
          useValue: mockScanResultRepo,
        },
        {
          provide: getRepositoryToken(UploadedFile),
          useValue: mockFileRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FileScanService>(FileScanService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("scanFile", () => {
    it("should mark clean files as processing", async () => {
      const file: Partial<UploadedFile> = {
        id: "test-id",
        storagePath: "test/photo.jpg",
        status: FileStatus.UPLOADING,
        scanStatus: "pending",
      };

      const cleanBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);

      mockScanResultRepo.create.mockReturnValue({ id: "scan-1" });
      mockScanResultRepo.save.mockResolvedValue({ id: "scan-1" });
      mockFileRepo.save.mockResolvedValue(file);

      const result = await service.scanFile(file as UploadedFile, cleanBuffer);

      expect(mockFileRepo.save).toHaveBeenCalled();
      expect(file.status).toBe(FileStatus.PROCESSING);
      expect(file.scanStatus).toBe(ScanStatus.CLEAN);
      expect(result).toBeDefined();
    });

    it("should mark infected files as infected", async () => {
      const file: Partial<UploadedFile> = {
        id: "test-id",
        storagePath: "test/malware.bin",
        status: FileStatus.UPLOADING,
        scanStatus: "pending",
      };

      // EICAR test string
      const eicarBuffer = Buffer.from(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      );

      mockScanResultRepo.create.mockReturnValue({ id: "scan-2" });
      mockScanResultRepo.save.mockResolvedValue({ id: "scan-2" });
      mockFileRepo.save.mockResolvedValue(file);

      const result = await service.scanFile(file as UploadedFile, eicarBuffer);

      expect(file.status).toBe(FileStatus.INFECTED);
      expect(file.scanStatus).toBe(ScanStatus.INFECTED);
      expect(result).toBeDefined();
    });

    it("should skip scanning when disabled", async () => {
      // Use an isolated config mock to avoid mutating the shared one
      const disabledConfigService = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === "FILE_SCAN_ENABLED") return false;
          return defaultValue;
        }),
      };

      // Re-create service with disabled scanning
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileScanService,
          {
            provide: getRepositoryToken(FileScanResult),
            useValue: mockScanResultRepo,
          },
          {
            provide: getRepositoryToken(UploadedFile),
            useValue: mockFileRepo,
          },
          { provide: ConfigService, useValue: disabledConfigService },
        ],
      }).compile();

      const disabledService = module.get<FileScanService>(FileScanService);

      const file: Partial<UploadedFile> = {
        id: "test-id",
        storagePath: "test/file.bin",
        status: FileStatus.UPLOADING,
      };

      const result = await disabledService.scanFile(
        file as UploadedFile,
        Buffer.from("test"),
      );

      expect(result).toBeDefined();
      expect(mockScanResultRepo.save).not.toHaveBeenCalled();
    });

    it("should detect script injection in images", async () => {
      const file: Partial<UploadedFile> = {
        id: "test-id",
        storagePath: "test/injected.jpg",
        status: FileStatus.UPLOADING,
        scanStatus: "pending",
      };

      // JPEG SOI marker + script tag payload
      const buffer = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from("<script>alert('xss')</script>"),
      ]);

      mockScanResultRepo.create.mockReturnValue({ id: "scan-3" });
      mockScanResultRepo.save.mockResolvedValue({ id: "scan-3" });
      mockFileRepo.save.mockResolvedValue(file);

      await service.scanFile(file as UploadedFile, buffer);

      expect(file.scanStatus).toBe(ScanStatus.INFECTED);
      expect(file.status).toBe(FileStatus.INFECTED);
      expect(file.scanEngine).toBe("signature-check");
    });
  });

  describe("getScanResults", () => {
    it("should return scan results for a file", async () => {
      const mockResults = [
        {
          id: "scan-1",
          fileId: "test-id",
          status: ScanStatus.CLEAN,
          engine: "signature-check",
        },
      ];
      mockScanResultRepo.find.mockResolvedValue(mockResults);

      const results = await service.getScanResults("test-id");
      expect(results).toEqual(mockResults);
      expect(mockScanResultRepo.find).toHaveBeenCalledWith({
        where: { fileId: "test-id" },
        order: { createdAt: "DESC" },
      });
    });
  });
});
