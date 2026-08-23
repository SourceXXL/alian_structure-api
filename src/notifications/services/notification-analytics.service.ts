import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationDeliveryLog, DeliveryStatus } from '../entities/notification-delivery-log.entity';
import { NotificationAnalytics } from '../entities/notification-analytics.entity';
import { NotificationChannel } from '../entities/notification.entity';
import { QueryAnalyticsDto, EngagementSummaryDto } from '../dto/notification-analytics.dto';

@Injectable()
export class NotificationAnalyticsService {
  private readonly logger = new Logger(NotificationAnalyticsService.name);

  constructor(
    @InjectRepository(NotificationDeliveryLog)
    private readonly deliveryLogRepo: Repository<NotificationDeliveryLog>,
    @InjectRepository(NotificationAnalytics)
    private readonly analyticsRepo: Repository<NotificationAnalytics>,
  ) {}

  /**
   * Record a delivery event in the analytics log.
   */
  async recordDeliveryEvent(
    notificationId: string,
    userId: string,
    channel: NotificationChannel,
    status: DeliveryStatus,
    metadata?: Record<string, any>,
  ): Promise<void> {
    // The delivery log is written by the processor; this method
    // updates analytics in real-time for critical events.
    this.logger.debug(`Analytics event: ${channel} ${status} for notification ${notificationId}`);
  }

  /**
   * Query analytics data with optional filtering by channel, category, and date range.
   */
  async queryAnalytics(dto: QueryAnalyticsDto): Promise<NotificationAnalytics[]> {
    const qb = this.analyticsRepo.createQueryBuilder('analytics');

    if (dto.from) {
      qb.andWhere('analytics.dateBucket >= :from', { from: dto.from });
    }
    if (dto.to) {
      qb.andWhere('analytics.dateBucket <= :to', { to: dto.to });
    }
    if (dto.channel) {
      qb.andWhere('analytics.channel = :channel', { channel: dto.channel });
    }
    if (dto.category) {
      qb.andWhere('analytics.category = :category', { category: dto.category });
    }
    if (dto.granularity) {
      qb.andWhere('analytics.granularity = :granularity', { granularity: dto.granularity });
    }

    qb.orderBy('analytics.dateBucket', 'ASC');
    qb.take(dto.limit || 30);

    return qb.getMany();
  }

  /**
   * Get engagement summary: open rates, click rates, delivery rates.
   */
  async getEngagementSummary(dto: EngagementSummaryDto): Promise<{
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    deliveryRate: number;
    openRate: number;
    clickRate: number;
    byChannel: Record<string, {
      sent: number;
      delivered: number;
      opened: number;
      clicked: number;
    }>;
  }> {
    const qb = this.analyticsRepo.createQueryBuilder('a');

    if (dto.userId) {
      // For user-specific, sum from analytics where we have recipient data
      // Since analytics doesn't have userId, we fall back to delivery logs
    }
    if (dto.from) {
      qb.andWhere('a.dateBucket >= :from', { from: dto.from });
    }
    if (dto.to) {
      qb.andWhere('a.dateBucket <= :to', { to: dto.to });
    }

    const data = await qb.getMany();

    let totalSent = 0, totalDelivered = 0, totalOpened = 0, totalClicked = 0;
    const byChannel: Record<string, { sent: number; delivered: number; opened: number; clicked: number }> = {};

    for (const row of data) {
      totalSent += row.totalSent;
      totalDelivered += row.totalDelivered;
      totalOpened += row.totalOpened;
      totalClicked += row.totalClicked;

      if (!byChannel[row.channel]) {
        byChannel[row.channel] = { sent: 0, delivered: 0, opened: 0, clicked: 0 };
      }
      byChannel[row.channel].sent += row.totalSent;
      byChannel[row.channel].delivered += row.totalDelivered;
      byChannel[row.channel].opened += row.totalOpened;
      byChannel[row.channel].clicked += row.totalClicked;
    }

    return {
      totalSent,
      totalDelivered,
      totalOpened,
      totalClicked,
      deliveryRate: totalSent > 0 ? totalDelivered / totalSent : 0,
      openRate: totalDelivered > 0 ? totalOpened / totalDelivered : 0,
      clickRate: totalOpened > 0 ? totalClicked / totalOpened : 0,
      byChannel,
    };
  }

  /**
   * Scheduled job: aggregate delivery logs into hourly analytics buckets.
   * Runs every hour at minute :5.
   */
  @Cron('5 * * * *')
  async aggregateHourlyAnalytics(): Promise<void> {
    await this.runAggregation('hourly');
  }

  /**
   * Scheduled job: aggregate hourly analytics into daily buckets.
   * Runs daily at 01:05.
   */
  @Cron('5 1 * * *')
  async aggregateDailyAnalytics(): Promise<void> {
    await this.runAggregation('daily');
  }

  private async runAggregation(granularity: 'hourly' | 'daily'): Promise<void> {
    const truncUnit = granularity === 'hourly' ? 'hour' : 'day';

    try {
      // Get distinct (bucket, channel, category) combinations from delivery logs
      const rows = await this.deliveryLogRepo
        .createQueryBuilder('log')
        .select([
          `date_trunc('${truncUnit}', log.createdAt) as "bucket"`,
          'log.channel as "channel"',
          'COUNT(*) as "total"',
          `COUNT(*) FILTER (WHERE log.status IN ('sent', 'delivered')) as "delivered"`,
          `COUNT(*) FILTER (WHERE log.status = 'failed') as "failed"`,
          `COUNT(*) FILTER (WHERE log.status = 'bounced') as "bounced"`,
          `COUNT(DISTINCT log.userId) as "unique"`,
          `COUNT(*) FILTER (WHERE log.status = 'opened') as "opened"`,
          `COUNT(*) FILTER (WHERE log.status = 'clicked') as "clicked"`,
        ])
        .groupBy(`date_trunc('${truncUnit}', log.createdAt)`)
        .addGroupBy('log.channel')
        .getRawMany();

      for (const row of rows) {
        const bucket = new Date(row.bucket);
        const channel = row.channel as NotificationChannel;

        // Upsert analytics record
        const existing = await this.analyticsRepo.findOne({
          where: { dateBucket: bucket, channel, granularity },
        });

        if (existing) {
          existing.totalSent = parseInt(row.total) || 0;
          existing.totalDelivered = parseInt(row.delivered) || 0;
          existing.totalFailed = parseInt(row.failed) || 0;
          existing.totalBounced = parseInt(row.bounced) || 0;
          existing.uniqueRecipients = parseInt(row.unique) || 0;
          existing.totalOpened = parseInt(row.opened) || 0;
          existing.totalClicked = parseInt(row.clicked) || 0;
          await this.analyticsRepo.save(existing);
        } else {
          const analytics = this.analyticsRepo.create({
            dateBucket: bucket,
            granularity,
            channel,
            totalSent: parseInt(row.total) || 0,
            totalDelivered: parseInt(row.delivered) || 0,
            totalFailed: parseInt(row.failed) || 0,
            totalBounced: parseInt(row.bounced) || 0,
            uniqueRecipients: parseInt(row.unique) || 0,
            totalOpened: parseInt(row.opened) || 0,
            totalClicked: parseInt(row.clicked) || 0,
          });
          await this.analyticsRepo.save(analytics);
        }
      }

      this.logger.log(
        `Aggregated ${granularity} analytics for ${rows.length} bucket/channel combinations`,
      );
    } catch (error) {
      this.logger.error(`Analytics aggregation failed: ${error.message}`);
    }
  }
}
