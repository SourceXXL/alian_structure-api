import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { Session } from "inspector";
import { getHeapSnapshot, getHeapStatistics } from "v8";
import { performance, PerformanceObserver } from "perf_hooks";
import * as Sentry from "@sentry/node";
import { register } from "../config/metrics";

const execAsync = promisify(exec);

export interface ProfileMetadata {
  id: string;
  type: "cpu" | "heap" | "timeline";
  startTime: Date;
  endTime?: Date;
  size: number;
  filePath: string;
  status: "active" | "completed" | "failed";
}

export interface HotFunction {
  name: string;
  selfTime: number;
  totalTime: number;
  callCount: number;
}

@Injectable()
export class ProfilingService {
  private readonly logger = new Logger(ProfilingService.name);
  private readonly profilesDir = path.join(
    os.tmpdir(),
    "alian-structure-profiles",
  );
  private activeProfiles: Map<string, ProfileMetadata> = new Map();
  private cpuProfiler: any = null;
  private performanceObserver: PerformanceObserver | null = null;
  private functionCalls: Map<string, { count: number; totalTime: number }> =
    new Map();
  private memoryLeakThreshold = 0.9; // 90% memory usage threshold
  private baselineMetrics: any = null;

  constructor() {
    // Ensure profiles directory exists
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
    }
    this.initializePerformanceObserver();
    this.establishPerformanceBaseline();
    this.startMemoryLeakMonitoring();
  }

  /**
   * Initialize performance observer to track function timings
   */
  private initializePerformanceObserver() {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.entryType === "function") {
          const key = entry.name;
          const current = this.functionCalls.get(key) || {
            count: 0,
            totalTime: 0,
          };
          current.count += 1;
          current.totalTime += entry.duration;
          this.functionCalls.set(key, current);
        }
      });
    });
    this.performanceObserver.observe({ entryTypes: ["function"] });
  }

  /**
   * Establish baseline performance metrics for regression detection
   */
  private async establishPerformanceBaseline() {
    const metrics = await register.getMetricsAsJSON();
    this.baselineMetrics = {
      timestamp: new Date(),
      metrics,
      memory: getHeapStatistics(),
      cpu: os.loadavg(),
    };
    this.logger.log("Performance baseline established", this.baselineMetrics);
  }

  /**
   * Start memory leak monitoring
   */
  private startMemoryLeakMonitoring() {
    setInterval(() => {
      const stats = getHeapStatistics();
      const usedPercent = stats.used_heap_size / stats.heap_size_limit;

      if (usedPercent > this.memoryLeakThreshold) {
        this.logger.warn(
          `High memory usage detected: ${(usedPercent * 100).toFixed(2)}%`,
        );
        Sentry.captureEvent({
          message: "High memory usage detected - potential memory leak",
          level: "warning",
          contexts: {
            memory: stats as Record<string, any>,
          },
        });
      }
    }, 60000); // Check every minute
  }

  /**
   * Start CPU profiling
   */
  async startCPUProfile(
    durationMs: number = 30000,
  ): Promise<{ profileId: string }> {
    const session = new Session();
    session.connect();

    const profileId = `cpu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const filePath = path.join(this.profilesDir, `${profileId}.cpuprofile`);

    const metadata: ProfileMetadata = {
      id: profileId,
      type: "cpu",
      startTime: new Date(),
      filePath,
      status: "active",
      size: 0,
    };
    this.activeProfiles.set(profileId, metadata);
    this.cpuProfiler = session;

    session.post("Profiler.enable", () => {
      session.post("Profiler.start", async () => {
        this.logger.log(`CPU profiling started: ${profileId}`);

        // Stop after duration
        setTimeout(async () => {
          session.post("Profiler.stop", (err: any, params: any) => {
            if (err) {
              this.logger.error("CPU profiling failed", err);
              metadata.status = "failed";
              return;
            }

            fs.writeFileSync(filePath, JSON.stringify(params.profile));
            const stats = fs.statSync(filePath);
            metadata.endTime = new Date();
            metadata.size = stats.size;
            metadata.status = "completed";
            this.activeProfiles.set(profileId, metadata);

            this.logger.log(
              `CPU profiling completed: ${profileId}, size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`,
            );
            session.disconnect();
            this.cpuProfiler = null;
          });
        }, durationMs);
      });
    });

    return { profileId };
  }

  /**
   * Take heap snapshot immediately
   */
  async takeHeapSnapshot(): Promise<{
    snapshotId: string;
    path: string;
    size: number;
  }> {
    const snapshotId = `heap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const filePath = path.join(this.profilesDir, `${snapshotId}.heapsnapshot`);
    const writeStream = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      const snapshotStream = getHeapSnapshot();
      snapshotStream.pipe(writeStream);

      snapshotStream.on("error", (err) => {
        this.logger.error("Heap snapshot failed", err);
        reject(err);
      });

      writeStream.on("finish", () => {
        const stats = fs.statSync(filePath);
        const metadata: ProfileMetadata = {
          id: snapshotId,
          type: "heap",
          startTime: new Date(),
          endTime: new Date(),
          filePath,
          size: stats.size,
          status: "completed",
        };
        this.activeProfiles.set(snapshotId, metadata);

        this.logger.log(
          `Heap snapshot created: ${snapshotId}, size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`,
        );

        resolve({
          snapshotId,
          path: filePath,
          size: stats.size,
        });
      });
    });
  }

  /**
   * Get hot functions from collected metrics
   */
  getHotFunctions(): HotFunction[] {
    const functions: HotFunction[] = [];

    this.functionCalls.forEach((value, key) => {
      functions.push({
        name: key,
        selfTime: value.totalTime / value.count,
        totalTime: value.totalTime,
        callCount: value.count,
      });
    });

    // Sort by total time to get hottest functions
    return functions.sort((a, b) => b.totalTime - a.totalTime).slice(0, 20);
  }

  /**
   * Get request timeline waterfall data
   */
  getRequestTimelines() {
    const entries = performance.getEntriesByType("measure");
    return entries
      .map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
        entryType: entry.entryType,
      }))
      .sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Get all collected profiles
   */
  listProfiles(): ProfileMetadata[] {
    return Array.from(this.activeProfiles.values());
  }

  /**
   * Get profile file path for download
   */
  getProfilePath(profileId: string): string | null {
    const profile = this.activeProfiles.get(profileId);
    return profile ? profile.filePath : null;
  }

  /**
   * Check for performance regressions against baseline
   */
  checkPerformanceRegressions() {
    const currentMetrics = {
      timestamp: new Date(),
      memory: getHeapStatistics(),
      cpu: os.loadavg(),
    };

    const regressions: string[] = [];

    // Check CPU usage regression
    if (this.baselineMetrics) {
      const cpu1Avg = currentMetrics.cpu[0];
      const baselineCpu1 = this.baselineMetrics.cpu[0];
      if (cpu1Avg > baselineCpu1 * 1.5) {
        regressions.push(
          `CPU usage increased by ${((cpu1Avg / baselineCpu1 - 1) * 100).toFixed(2)}%`,
        );
      }

      // Check memory regression
      const currentMemoryUsage =
        currentMetrics.memory.used_heap_size /
        currentMetrics.memory.heap_size_limit;
      const baselineMemoryUsage =
        this.baselineMetrics.memory.used_heap_size /
        this.baselineMetrics.memory.heap_size_limit;
      if (currentMemoryUsage > baselineMemoryUsage * 1.3) {
        regressions.push(
          `Memory usage increased by ${((currentMemoryUsage / baselineMemoryUsage - 1) * 100).toFixed(2)}%`,
        );
      }
    }

    if (regressions.length > 0) {
      this.logger.warn("Performance regressions detected", regressions);
      Sentry.captureEvent({
        message: "Performance regressions detected",
        level: "warning",
        contexts: {
          regressions: regressions as Record<string, any>,
          baseline: this.baselineMetrics as Record<string, any>,
          current: currentMetrics as Record<string, any>,
        },
      });
    }

    return regressions;
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats() {
    const stats = getHeapStatistics();
    return {
      totalHeapSize: stats.total_heap_size,
      usedHeapSize: stats.used_heap_size,
      heapSizeLimit: stats.heap_size_limit,
      mallocedMemory: stats.malloced_memory,
      peakMallocedMemory: stats.peak_malloced_memory,
      percentUsed:
        ((stats.used_heap_size / stats.heap_size_limit) * 100).toFixed(2) + "%",
    };
  }

  /**
   * Delete a profile
   */
  deleteProfile(profileId: string): boolean {
    const profile = this.activeProfiles.get(profileId);
    if (profile && fs.existsSync(profile.filePath)) {
      fs.unlinkSync(profile.filePath);
      this.activeProfiles.delete(profileId);
      return true;
    }
    return false;
  }
}
