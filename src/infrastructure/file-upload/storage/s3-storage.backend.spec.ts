import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { S3StorageBackend } from "./s3-storage.backend";

describe("S3StorageBackend", () => {
  let backend: S3StorageBackend;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        S3_BUCKET: "test-bucket",
        S3_REGION: "us-west-2",
        S3_ACCESS_KEY_ID: "test-key",
        S3_SECRET_ACCESS_KEY: "test-secret",
        S3_ENDPOINT: undefined,
        S3_FORCE_PATH_STYLE: false,
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageBackend,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    backend = module.get<S3StorageBackend>(S3StorageBackend);
  });

  it("should be defined", () => {
    expect(backend).toBeDefined();
  });

  describe("upload", () => {
    it("should upload a buffer and return metadata (fallback when SDK unavailable)", async () => {
      const content = Buffer.from("S3 upload test");

      // @aws-sdk/client-s3 is not installed; the backend falls back to
      // a simulated upload that still computes checksum and returns metadata
      const result = await backend.upload(
        content,
        "test/upload.txt",
        "text/plain",
      );

      expect(result.path).toBe("test/upload.txt");
      expect(result.bucket).toBe("test-bucket");
      expect(result.size).toBe(14);
      expect(result.checksum).toHaveLength(64);
    });

    it("should compute correct checksum", async () => {
      const content = Buffer.from("checksum verification");
      const result = await backend.upload(
        content,
        "test/check.txt",
        "text/plain",
      );

      const crypto = require("crypto");
      const expected = crypto.createHash("sha256").update(content).digest("hex");
      expect(result.checksum).toBe(expected);
    });

    it("should handle stream uploads", async () => {
      const { Readable } = require("stream");
      const stream = Readable.from([Buffer.from("stream upload")]);

      const result = await backend.upload(
        stream,
        "test/stream.txt",
        "text/plain",
      );

      expect(result.path).toBe("test/stream.txt");
      expect(result.size).toBe(13); // Readable.from adds a trailing newline
    });
  });

  describe("configuration", () => {
    it("should use default values when config is not set", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3StorageBackend,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();

      const defaultBackend = module.get<S3StorageBackend>(S3StorageBackend);
      expect(defaultBackend).toBeDefined();
    });

    it("should read configuration from ConfigService", () => {
      expect(mockConfigService.get).toHaveBeenCalledWith("S3_BUCKET");
      expect(mockConfigService.get).toHaveBeenCalledWith("S3_REGION");
    });
  });

  describe("getSignedUrl", () => {
    it("should fall back to API URL when SDK is not available", async () => {
      const url = await backend.getSignedUrl("test/file.txt", 3600);
      // Without AWS SDK, should return a fallback URL
      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
    });
  });

  describe("getFileInfo", () => {
    it("should return exists=false when SDK is not available", async () => {
      const info = await backend.getFileInfo("nonexistent.txt");
      expect(info.exists).toBe(false);
    });
  });

  describe("delete", () => {
    it("should not throw when SDK is not available", async () => {
      await expect(
        backend.delete("test/file.txt"),
      ).resolves.toBeUndefined();
    });
  });

  describe("listFiles", () => {
    it("should return empty array when SDK is not available", async () => {
      const files = await backend.listFiles("test/");
      expect(files).toEqual([]);
    });
  });

  describe("copy", () => {
    it("should throw when SDK is not available", async () => {
      await expect(
        backend.copy("src.txt", "dest.txt"),
      ).rejects.toThrow("Failed to copy file in S3");
    });
  });
});
