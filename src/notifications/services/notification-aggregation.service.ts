import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { NotificationAggregation } from '../entities/notification-aggregation.entity';

/**
 * Default cooldown in seconds before a new notification with the same
 * aggregation key is allowed to be sent.
 */
const DEFAULT_COOLDOWN_SECONDS = 300; // 5 minutes

@Injectable()
export class NotificationAggregationService {
  private readonly logger = new Logger(NotificationAggregationService.name);

  constructor(
    @InjectRepository(NotificationAggregation)
    private readonly aggregationRepo: Repository<NotificationAggregation>,
  ) {}

  /**
   * Check whether a new notification should be aggregated (suppressed)
   * or allowed through. Returns { shouldSuppress, aggregationId, count }.
   *
   * If suppression is allowed, the caller should increment the aggregation
   * count and skip sending a new notification. If the cooldown has expired,
   * a new notification is allowed and the old aggregation is marked for
   * delivery.
   */
  async checkAggregation(
    userId: string,
    aggregationKey: string,
    cooldownSeconds: number = DEFAULT_COOLDOWN_SECONDS,
  ): Promise<{
    shouldSuppress: boolean;
    aggregation?: NotificationAggregation;
    currentCount: number;
  }> {
    if (!aggregationKey) {
      return { shouldSuppress: false, currentCount: 0 };
    }

    const existing = await this.aggregationRepo.findOne({
      where: {
        userId,
        aggregationKey,
        sent: false,
      },
    });

    if (!existing) {
      // No existing aggregation window — create one
      const newAgg = this.aggregationRepo.create({
        userId,
        aggregationKey,
        count: 1,
        latestNotificationId: '',
        windowStartedAt: new Date(),
        lastNotificationAt: new Date(),
        cooldownSeconds,
        sent: false,
      });
      const saved = await this.aggregationRepo.save(newAgg);
      return { shouldSuppress: false, aggregation: saved, currentCount: 1 };
    }

    // Check if the cooldown has expired
    const lastNotificationTime = existing.lastNotificationAt.getTime();
    const now = Date.now();
    const cooldownMs = existing.cooldownSeconds * 1000;

    if (now - lastNotificationTime < cooldownMs) {
      // Cooldown is still active — suppress
      existing.count += 1;
      existing.lastNotificationAt = new Date();
      await this.aggregationRepo.save(existing);
      this.logger.debug(
        `Notification suppressed by aggregation: key=${aggregationKey}, count=${existing.count}`,
      );
      return { shouldSuppress: true, aggregation: existing, currentCount: existing.count };
    }

    // Cooldown expired — mark the old aggregation as sent and start a new window
    existing.sent = true;
    await this.aggregationRepo.save(existing);

    const newAgg = this.aggregationRepo.create({
      userId,
      aggregationKey,
      count: 1,
      latestNotificationId: '',
      windowStartedAt: new Date(),
      lastNotificationAt: new Date(),
      cooldownSeconds,
      sent: false,
    });
    const saved = await this.aggregationRepo.save(newAgg);
    return { shouldSuppress: false, aggregation: saved, currentCount: 1 };
  }

  /**
   * Update the aggregation record with the actual notification ID
   * that was sent.
   */
  async linkNotification(
    aggregationId: string,
    notificationId: string,
  ): Promise<void> {
    await this.aggregationRepo.update(aggregationId, {
      latestNotificationId: notificationId,
    });
  }

  /**
   * Mark an aggregation as sent.
   */
  async markSent(aggregationId: string): Promise<void> {
    await this.aggregationRepo.update(aggregationId, { sent: true });
  }

  /**
   * Get aggregation stats for a user and key.
   */
  async getAggregationStats(
    userId: string,
    aggregationKey: string,
  ): Promise<{ count: number; lastNotificationAt: Date } | null> {
    const agg = await this.aggregationRepo.findOne({
      where: { userId, aggregationKey, sent: false },
      order: { createdAt: 'DESC' },
    });
    if (!agg) return null;
    return { count: agg.count, lastNotificationAt: agg.lastNotificationAt };
  }

  /**
   * Clean up old aggregation records (older than 7 days).
   */
  async cleanupOldAggregations(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.aggregationRepo.delete({
      createdAt: MoreThan(sevenDaysAgo) ? undefined : sevenDaysAgo,
    } as any);
    // Alternative: raw delete
    const deleteResult = await this.aggregationRepo
      .createQueryBuilder()
      .delete()
      .where('createdAt < :date', { date: sevenDaysAgo })
      .execute();
    return deleteResult.affected || 0;
  }
}
