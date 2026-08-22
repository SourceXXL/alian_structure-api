import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { LocalStorageBackend } from "./local-storage.backend";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("LocalStorageBackend", () => {
  let backend: LocalStorageBackend;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-upload-test-"));

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === "FILE_STORAGE_LOCAL_PATH") return tempDir;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStorageBackend,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    backend = module.get<LocalStorageBackend>(LocalStorageBackend);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should be defined", () => {
    expect(backend).toBeDefined();
  });

  describe("upload", () => {
    it("should upload a buffer and return metadata", async () => {
      const content = Buffer.from("Hello, World!");
      const result = await backend.upload(content, "test/hello.txt", "text/plain");

      expect(result.path).toBe("test/hello.txt");
      expect(result.size).toBe(13);
      expect(result.checksum).toBeDefined();
      expect(result.checksum).toHaveLength(64); // SHA-256 hex

      // Verify file exists on disk
      const fullPath = path.join(tempDir, "test/hello.txt");
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.readFileSync(fullPath).toString()).toBe("Hello, World!");
    });

    it("should upload from a readable stream", async () => {
      const { Readable } = require("stream");
      const stream = Readable.from([Buffer.from("Stream content")]);
      const result = await backend.upload(stream, "test/stream.txt", "text/plain");

      expect(result.path).toBe("test/stream.txt");
      expect(result.size).toBe(14);

      const fullPath = path.join(tempDir, "test/stream.txt");
      expect(fs.readFileSync(fullPath).toString()).toBe("Stream content");
    });

    it("should create nested directories", async () => {
      await backend.upload(
        Buffer.from("nested"),
        "a/b/c/deep.txt",
        "text/plain",
      );
      expect(
        fs.existsSync(path.join(tempDir, "a/b/c/deep.txt")),
      ).toBe(true);
    });

    it("should compute correct checksum", async () => {
      const content = Buffer.from("checksum test");
      const result = await backend.upload(content, "checksum.txt", "text/plain");

      const crypto = require("crypto");
      const expected = crypto.createHash("sha256").update(content).digest("hex");
      expect(result.checksum).toBe(expected);
    });
  });

  describe("download", () => {
    it("should return a readable stream for an existing file", async () => {
      await backend.upload(Buffer.from("download me"), "dl.txt", "text/plain");

      const stream = await backend.download("dl.txt");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks).toString()).toBe("download me");
    });

    it("should throw for a non-existent file", async () => {
      await expect(backend.download("missing.txt")).rejects.toThrow(
        "File not found",
      );
    });
  });

  describe("delete", () => {
    it("should delete an existing file", async () => {
      await backend.upload(Buffer.from("delete me"), "del.txt", "text/plain");
      expect(
        fs.existsSync(path.join(tempDir, "del.txt")),
      ).toBe(true);

      await backend.delete("del.txt");
      expect(
        fs.existsSync(path.join(tempDir, "del.txt")),
      ).toBe(false);
    });

    it("should not throw when deleting a non-existent file", async () => {
      await expect(backend.delete("nonexistent.txt")).resolves.toBeUndefined();
    });
  });

  describe("getSignedUrl", () => {
    it("should return an API endpoint URL", async () => {
      const url = await backend.getSignedUrl("test/file.txt", 3600);
      expect(url).toContain("/api/v1/files/");
      expect(url).toContain("raw");
    });
  });

  describe("getFileInfo", () => {
    it("should return file info for existing files", async () => {
      await backend.upload(Buffer.from("info"), "info.txt", "text/plain");

      const info = await backend.getFileInfo("info.txt");
      expect(info.exists).toBe(true);
      expect(info.size).toBe(4);
      expect(info.lastModified).toBeDefined();
      expect(info.lastModified.getTime()).toBeGreaterThan(0);
    });

    it("should return exists=false for non-existent files", async () => {
      const info = await backend.getFileInfo("missing.txt");
      expect(info.exists).toBe(false);
    });
  });

  describe("copy", () => {
    it("should copy a file", async () => {
      await backend.upload(Buffer.from("copy me"), "src.txt", "text/plain");
      await backend.copy("src.txt", "dest.txt");

      const content = fs.readFileSync(
        path.join(tempDir, "dest.txt"),
      );
      expect(content.toString()).toBe("copy me");
    });
  });

  describe("listFiles", () => {
    it("should list files under a prefix", async () => {
      await backend.upload(Buffer.from("1"), "list/a.txt", "text/plain");
      await backend.upload(Buffer.from("2"), "list/b.txt", "text/plain");
      await backend.upload(Buffer.from("3"), "other/c.txt", "text/plain");

      const files = await backend.listFiles("list");
      expect(files).toHaveLength(2);
      // Normalize paths for cross-platform compatibility
      const normalized = files.sort().map((f) => f.replace(/\\/g, "/"));
      expect(normalized).toEqual(["list/a.txt", "list/b.txt"]);
    });

    it("should return empty array for non-existent prefix", async () => {
      const files = await backend.listFiles("empty-dir");
      expect(files).toEqual([]);
    });
  });
});
