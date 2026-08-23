import { Injectable, Logger } from "@nestjs/common";
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { Session } from "inspector";
import * as process from "process";

export interface ProfileOptions {
  duration?: number; // in milliseconds
  sampleInterval?: number; // in microseconds
}

export interface HeapSnapshotOptions {
  filename?: string;
}

@Injectable()
export class ProfilingService {
  private readonly logger = new Logger(ProfilingService.name);
  private session: Session | null = null;
  private isProfiling = false;
  private profilesDir: string;

  constructor() {
    this.profilesDir = join(process.cwd(), "profiles");
    if (!existsSync(this.profilesDir)) {
      mkdirSync(this.profilesDir, { recursive: true });
    }
  }

  /**
   * Start CPU profiling
   */
  async startCpuProfiling(): Promise<{ success: boolean; message: string }> {
    if (this.isProfiling) {
      return { success: false, message: "CPU profiling is already running" };
    }

    try {
      this.session = new Session();
      this.session.connect();

      return new Promise((resolve, reject) => {
        if (!this.session) {
          reject(new Error("Failed to create inspector session"));
          return;
        }

        this.session.post("Profiler.enable", () => {
          this.session!.post("Profiler.start", {}, (err) => {
            if (err) {
              reject(err);
              return;
            }
            this.isProfiling = true;
            this.logger.log("CPU profiling started");
            resolve({
              success: true,
              message: "CPU profiling started successfully",
            });
          });
        });
      });
    } catch (error) {
      this.logger.error("Failed to start CPU profiling", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to start CPU profiling: ${errorMessage}`,
      };
    }
  }

  /**
   * Stop CPU profiling and save the profile
   */
  async stopCpuProfiling(): Promise<{
    success: boolean;
    filename: string;
    message: string;
  }> {
    if (!this.isProfiling || !this.session) {
      return {
        success: false,
        filename: "",
        message: "No CPU profiling is currently running",
      };
    }

    return new Promise((resolve, reject) => {
      this.session!.post("Profiler.stop", (err, params) => {
        if (err) {
          reject(err);
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `cpu-profile-${timestamp}.cpuprofile`;
        const filePath = join(this.profilesDir, filename);

        const writeStream = createWriteStream(filePath);
        writeStream.write(JSON.stringify(params.profile));
        writeStream.end();

        writeStream.on("finish", () => {
          this.isProfiling = false;
          this.session!.disconnect();
          this.session = null;
          this.logger.log(`CPU profile saved to ${filePath}`);
          resolve({
            success: true,
            filename,
            message: `CPU profile saved to ${filename}`,
          });
        });

        writeStream.on("error", (writeErr) => {
          reject(writeErr);
        });
      });
    });
  }

  /**
   * Take a heap snapshot
   */
  async takeHeapSnapshot(
    options?: HeapSnapshotOptions,
  ): Promise<{ success: boolean; filename: string; message: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename =
      options?.filename || `heap-snapshot-${timestamp}.heapsnapshot`;
    const filePath = join(this.profilesDir, filename);

    try {
      const session = new Session();
      session.connect();

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];

        session.on(
          "HeapProfiler.addHeapSnapshotChunk",
          (params: { chunk: string }) => {
            chunks.push(Buffer.from(params.chunk));
          },
        );

        session.post(
          "HeapProfiler.takeHeapSnapshot",
          {},
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }

            const writeStream = createWriteStream(filePath);
            for (const chunk of chunks) {
              writeStream.write(chunk);
            }
            writeStream.end();

            writeStream.on("finish", () => {
              session.disconnect();
              this.logger.log(`Heap snapshot saved to ${filePath}`);
              resolve({
                success: true,
                filename,
                message: `Heap snapshot saved to ${filename}`,
              });
            });

            writeStream.on("error", (writeErr) => {
              reject(writeErr);
            });
          },
        );
      });
    } catch (error) {
      this.logger.error("Failed to take heap snapshot", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        filename: "",
        message: `Failed to take heap snapshot: ${errorMessage}`,
      };
    }
  }

  /**
   * Get list of all available profiles
   */
  getAvailableProfiles(): string[] {
    return readdirSync(this.profilesDir).filter(
      (file: string) =>
        file.endsWith(".cpuprofile") || file.endsWith(".heapsnapshot"),
    );
  }

  /**
   * Check if memory usage is concerning (leak detection)
   */
  checkMemoryHealth(): {
    status: "healthy" | "warning" | "critical";
    memoryUsage: NodeJS.MemoryUsage;
    recommendations: string[];
  } {
    const memoryUsage = process.memoryUsage();
    const recommendations: string[] = [];
    let status: "healthy" | "warning" | "critical" = "healthy";

    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
    const rssMB = memoryUsage.rss / 1024 / 1024;

    // If heap used is > 80% of heap total
    if (heapUsedMB > heapTotalMB * 0.8) {
      status = "warning";
      recommendations.push(
        "Heap usage is high. Consider taking a heap snapshot to investigate potential leaks.",
      );
    }

    // If heap used is > 95% of heap total
    if (heapUsedMB > heapTotalMB * 0.95) {
      status = "critical";
      recommendations.push(
        "CRITICAL: Heap usage is extremely high. Immediate investigation required.",
      );
    }

    // If RSS is unusually large (over 2GB)
    if (rssMB > 2048) {
      status = "warning";
      recommendations.push(
        "RSS memory usage exceeds 2GB. Monitor for potential memory leaks.",
      );
    }

    // External memory is large
    if (memoryUsage.external > 500 * 1024 * 1024) {
      // 500MB
      recommendations.push(
        "External memory usage is high. Check for native module memory leaks.",
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("Memory usage is within normal limits.");
    }

    return {
      status,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
      },
      recommendations,
    };
  }
}
