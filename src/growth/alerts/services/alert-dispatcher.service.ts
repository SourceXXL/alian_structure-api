import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AlertPreference,
  AlertFrequency,
} from "../entities/alert-preference.entity";
import { AlertTriggerLog } from "../entities/alert-trigger-log.entity";
import { EmailService } from "../../../email/email.service";
import { DashboardGateway } from "../../../dashboard/websocket/dashboard.gateway";
import { DashboardEvent } from "../../../dashboard/websocket/interfaces/websocket.interfaces";
import { PushNotificationService } from "./push-notification.service";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface DigestEntry {
  userId: string;
  payloads: object[];
  channels: string[];
}

@Injectable()
export class AlertDispatcherService {
  private readonly logger = new Logger(AlertDispatcherService.name);
  private readonly fingerprintMap = new Map<string, number>();
  private readonly rateLimitMap = new Map<string, RateLimitEntry>();
  private readonly digestMap = new Map<string, DigestEntry>();

  constructor(
    @InjectRepository(AlertPreference)
    private readonly preferenceRepo: Repository<AlertPreference>,
    @InjectRepository(AlertTriggerLog)
    private readonly logRepo: Repository<AlertTriggerLog>,
    @Optional()
    @Inject(EmailService)
    private readonly emailService?: EmailService,
    @Optional()
    @Inject(DashboardGateway)
    private readonly dashboardGateway?: DashboardGateway,
    @Optional()
    @Inject(PushNotificationService)
    private readonly pushService?: PushNotificationService,
  ) {}

  async dispatch(userId: string, payload: object): Promise<void> {
    const windowSlot = Math.floor(Date.now() / 300_000);
    const fingerprint = `${userId}:${JSON.stringify(payload)}:${windowSlot}`;

    if (this.fingerprintMap.has(fingerprint)) {
      this.logger.debug(`[Dedup] Skipping duplicate alert for user ${userId}`);
      return;
    }
    this.fingerprintMap.set(fingerprint, Date.now());

    const cutoff = Date.now() - 300_000;
    for (const [key, ts] of this.fingerprintMap.entries()) {
      if (ts < cutoff) this.fingerprintMap.delete(key);
    }

    const prefs = await this.preferenceRepo.findOne({ where: { userId } });
    const channels: string[] = prefs?.channels ?? ["in-app"];
    const rateLimit: number = prefs?.rateLimit ?? 10;
    const quietHoursStart: number | null = prefs?.quietHoursStart ?? null;
    const quietHoursEnd: number | null = prefs?.quietHoursEnd ?? null;
    const frequency: AlertFrequency =
      prefs?.frequency ?? AlertFrequency.REALTIME;
    const disabledTypes: string[] = prefs?.disabledAlertTypes ?? [];

    // Check if alert type is disabled
    const alertType = (payload as Record<string, unknown>).type as string;
    if (alertType && this.isAlertTypeDisabled(alertType, disabledTypes)) {
      this.logger.debug(
        `[DisabledType] Skipping ${alertType} alert for user ${userId}`,
      );
      return;
    }

    const now = Date.now();
    const hourMs = 3_600_000;
    const entry = this.rateLimitMap.get(userId);

    if (entry && now - entry.windowStart < hourMs) {
      if (entry.count >= rateLimit) {
        this.logger.warn(
          `[RateLimit] User ${userId} has reached ${rateLimit} alerts/hour limit`,
        );
        return;
      }
      entry.count += 1;
    } else {
      this.rateLimitMap.set(userId, { count: 1, windowStart: now });
    }

    if (
      quietHoursStart !== null &&
      quietHoursEnd !== null &&
      this.isInQuietHours(quietHoursStart, quietHoursEnd)
    ) {
      this.logger.debug(
        `[QuietHours] Suppressing alert for user ${userId} during quiet hours`,
      );
      return;
    }

    // Buffer for daily digest if frequency is daily_digest
    if (frequency === AlertFrequency.DAILY_DIGEST) {
      this.bufferForDigest(userId, payload, channels);
      this.logger.debug(
        `[Digest] Buffered alert for user ${userId} (daily digest)`,
      );
      return;
    }

    for (const channel of channels) {
      await this.deliverToChannel(channel, userId, payload, 1);
    }
  }

  /**
   * Flush all buffered digest alerts for a specific user.
   */
  async flushDigest(userId: string): Promise<void> {
    const entry = this.digestMap.get(userId);
    if (!entry || entry.payloads.length === 0) return;

    const summaryPayload = {
      type: "daily.digest",
      count: entry.payloads.length,
      alerts: entry.payloads,
    };

    for (const channel of entry.channels) {
      await this.deliverToChannel(channel, userId, summaryPayload, 1);
    }

    this.digestMap.delete(userId);
    this.logger.log(
      `[Digest] Flushed ${entry.payloads.length} alerts for user ${userId}`,
    );
  }

  /**
   * Flush all buffered digest alerts for all users.
   */
  async flushAllDigests(): Promise<void> {
    for (const userId of this.digestMap.keys()) {
      await this.flushDigest(userId);
    }
  }

  getDigestBufferSize(userId: string): number {
    return this.digestMap.get(userId)?.payloads.length ?? 0;
  }

  private bufferForDigest(
    userId: string,
    payload: object,
    channels: string[],
  ): void {
    const existing = this.digestMap.get(userId);
    if (existing) {
      existing.payloads.push(payload);
    } else {
      this.digestMap.set(userId, { userId, payloads: [payload], channels });
    }
  }

  private isAlertTypeDisabled(
    alertType: string,
    disabledTypes: string[],
  ): boolean {
    // Match the full event type string against disabled type patterns
    return disabledTypes.some(
      (disabled) =>
        alertType.includes(disabled) || disabled.includes(alertType),
    );
  }

  async deliverToChannel(
    channel: string,
    userId: string,
    payload: object,
    attempt: number,
  ): Promise<void> {
    try {
      if (channel === "in-app") {
        const log = this.logRepo.create({
          alertId: "dispatcher",
          userId,
          payload: { ...payload, channel: "in-app" } as Record<string, unknown>,
        });
        await this.logRepo.save(log);
        this.logger.log(`[In-App] Delivered alert to user ${userId}`);
      } else if (channel === "email") {
        if (this.emailService) {
          const p = payload as Record<string, unknown>;
          const alertType = (p.type as string) || "alert";
          const message = (p.message as string) || "";
          const html = this.buildEmailHtml(alertType, message);
          await this.emailService.sendEmail({
            to: [userId],
            subject: `[Alian] Alert: ${alertType}`,
            html,
            text: message || JSON.stringify(payload),
          } as any);
          this.logger.log(`[Email] Queued alert email for user ${userId}`);
        } else {
          this.logger.warn(
            `[Email] EmailService unavailable for user ${userId}`,
          );
        }
      } else if (channel === "websocket") {
        if (this.dashboardGateway) {
          this.dashboardGateway.broadcastToUser(
            userId,
            DashboardEvent.ALERT_TRIGGERED,
            payload,
          );
          this.logger.log(`[WebSocket] Pushed alert to user ${userId}`);
        } else {
          this.logger.warn(
            `[WebSocket] DashboardGateway unavailable for user ${userId}`,
          );
        }
      } else if (channel === "push") {
        if (this.pushService) {
          const p = payload as Record<string, unknown>;
          await this.pushService.send({
            userId,
            title: `Alert: ${(p.type as string) || "Notification"}`,
            body: (p.message as string) || JSON.stringify(payload),
            data: p as Record<string, unknown>,
          });
          this.logger.log(`[Push] Sent push notification to user ${userId}`);
        } else {
          this.logger.warn(
            `[Push] PushNotificationService unavailable for user ${userId}`,
          );
        }
      } else {
        this.logger.warn(`[Dispatcher] Unknown channel: ${channel}`);
      }
    } catch (err) {
      if (attempt < 3) {
        const backoffMs = 200 * Math.pow(2, attempt - 1);
        this.logger.warn(
          `[Retry] Attempt ${attempt} failed for channel ${channel}, user ${userId}. Retrying in ${backoffMs}ms`,
        );
        await this.sleep(backoffMs);
        return this.deliverToChannel(channel, userId, payload, attempt + 1);
      }
      this.logger.error(
        `[Dispatcher] Failed to deliver via ${channel} for user ${userId} after 3 attempts: ${(err as Error).message}`,
      );
    }
  }

  private buildEmailHtml(alertType: string, message: string): string {
    return `
      <h2>Alert: ${alertType}</h2>
      <p>${message || "You have a new notification from Alian Structure."}</p>
      <hr />
      <small>Alian Structure API — Notification Service</small>
    `;
  }

  private isInQuietHours(start: number, end: number): boolean {
    const currentHour = new Date().getHours();
    if (start <= end) {
      return currentHour >= start && currentHour < end;
    }
    return currentHour >= start || currentHour < end;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
