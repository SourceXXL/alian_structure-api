import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Notification,
  NotificationStatus,
  NotificationChannel,
  NotificationPriority,
} from '../entities/notification.entity';
import { NotificationDeliveryLog, DeliveryStatus } from '../entities/notification-delivery-log.entity';
import { SendNotificationDto, SendBulkNotificationDto } from '../dto/send-notification.dto';
import { QueryNotificationHistoryDto } from '../dto/query-notification.dto';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationAggregationService } from './notification-aggregation.service';
import { NotificationQueueService } from './notification-queue.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(NotificationDeliveryLog)
    private readonly deliveryLogRepo: Repository<NotificationDeliveryLog>,
    private readonly templateService: NotificationTemplateService,
    private readonly aggregationService: NotificationAggregationService,
    private readonly queueService: NotificationQueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Send a single notification, optionally through multiple channels.
   */
  async send(dto: SendNotificationDto): Promise<Notification> {
    // Check aggregation
    if (dto.aggregationKey) {
      const aggResult = await this.aggregationService.checkAggregation(
        dto.userId,
        dto.aggregationKey,
      );
      if (aggResult.shouldSuppress) {
        this.logger.log(
          `Notification suppressed by aggregation: key=${dto.aggregationKey}, count=${aggResult.currentCount}`,
        );
        // Still create a notification record, but mark it as suppressed via aggregation
        const suppressed = this.notificationRepo.create({
          userId: dto.userId,
          title: dto.title,
          body: dto.body,
          htmlBody: dto.htmlBody,
          category: dto.category,
          priority: dto.priority,
          primaryChannel: dto.primaryChannel || NotificationChannel.IN_APP,
          channels: dto.channels,
          templateName: dto.templateName,
          templateVars: dto.templateVars,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
          aggregationKey: dto.aggregationKey,
          aggregationCount: aggResult.currentCount,
          status: NotificationStatus.CANCELLED,
          metadata: { suppressedByAggregation: true },
        });
        return this.notificationRepo.save(suppressed);
      }
      // Link aggregation to the new notification after creation
    }

    // Render template if provided
    let title = dto.title;
    let body = dto.body;
    let htmlBody = dto.htmlBody;

    if (dto.templateName && dto.templateVars) {
      try {
        const template = await this.templateService.getTemplate(dto.templateName);
        body = this.templateService.renderBody(
          dto.templateName,
          template.bodyTemplate,
          dto.templateVars,
        );
        if (template.htmlTemplate) {
          htmlBody = this.templateService.renderBody(
            dto.templateName,
            template.htmlTemplate,
            dto.templateVars,
          );
        }
        if (template.subject) {
          title = this.templateService.renderBody(
            dto.templateName,
            template.subject,
            dto.templateVars,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Template "${dto.templateName}" not found, using raw title/body`,
        );
      }
    }

    // Determine channels
    const channels = dto.channels || [dto.primaryChannel || NotificationChannel.IN_APP];

    // Create the notification
    const notification = this.notificationRepo.create({
      userId: dto.userId,
      title,
      body,
      htmlBody,
      category: dto.category,
      priority: dto.priority || NotificationPriority.NORMAL,
      primaryChannel: dto.primaryChannel || NotificationChannel.IN_APP,
      channels,
      templateName: dto.templateName,
      templateVars: dto.templateVars,
      referenceId: dto.referenceId,
      referenceType: dto.referenceType,
      aggregationKey: dto.aggregationKey,
      aggregationCount: dto.aggregationKey ? 1 : 0,
      maxAttempts: dto.maxAttempts || 5,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      status: dto.scheduledAt ? NotificationStatus.SCHEDULED : NotificationStatus.QUEUED,
      metadata: dto.metadata,
    });

    const saved = await this.notificationRepo.save(notification);

    // Link aggregation
    if (dto.aggregationKey) {
      // Re-fetch to get the latest aggregation record
      const aggStats = await this.aggregationService.getAggregationStats(
        dto.userId,
        dto.aggregationKey,
      );
      if (aggStats) {
        // The aggregation was already created by checkAggregation, update the notification ID
        const aggRecords = await this.aggregationService['aggregationRepo'].find({
          where: { userId: dto.userId, aggregationKey: dto.aggregationKey, sent: false },
          order: { createdAt: 'DESC' },
          take: 1,
        });
        if (aggRecords.length > 0) {
          await this.aggregationService.linkNotification(aggRecords[0].id, saved.id);
        }
      }
    }

    // Queue for delivery
    if (!dto.scheduledAt) {
      await this.queueService.enqueueNotification(saved.id, {
        priority: this.priorityToNumber(saved.priority),
      });
    } else {
      await this.queueService.enqueueScheduledNotification(
        saved.id,
        new Date(dto.scheduledAt),
      );
    }

    this.logger.log(`Notification created: ${saved.id} for user ${dto.userId}`);
    return saved;
  }

  /**
   * Send notifications to multiple recipients.
   */
  async sendBulk(dto: SendBulkNotificationDto): Promise<Notification[]> {
    const results: Notification[] = [];
    for (const notifDto of dto.notifications) {
      try {
        results.push(await this.send(notifDto));
      } catch (error) {
        this.logger.error(
          `Bulk notification failed for user ${notifDto.userId}: ${error.message}`,
        );
      }
    }
    this.logger.log(`Bulk send: ${results.length}/${dto.notifications.length} succeeded`);
    return results;
  }

  /**
   * Cancel a scheduled notification.
   */
  async cancel(notificationId: string): Promise<Notification> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    if (notification.status !== NotificationStatus.SCHEDULED) {
      throw new BadRequestException(
        `Cannot cancel notification in status ${notification.status}`,
      );
    }

    await this.queueService.cancelNotification(notificationId);
    notification.status = NotificationStatus.CANCELLED;
    return this.notificationRepo.save(notification);
  }

  /**
   * Get notification history for a user with pagination.
   */
  async getHistory(dto: QueryNotificationHistoryDto): Promise<{
    data: Notification[];
    total: number;
    nextCursor: string | null;
  }> {
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId: dto.userId })
      .andWhere('n.deleted = false');

    if (dto.category) {
      qb.andWhere('n.category = :category', { category: dto.category });
    }
    if (dto.channel) {
      qb.andWhere(
        '(n.primaryChannel = :channel OR :channel = ANY(n.channels))',
        { channel: dto.channel },
      );
    }
    if (dto.read !== undefined) {
      if (dto.read) {
        qb.andWhere('n.read = true');
      } else {
        qb.andWhere('n.read = false');
      }
    }
    if (dto.status) {
      qb.andWhere('n.status = :status', { status: dto.status });
    }
    if (dto.priority) {
      qb.andWhere('n.priority = :priority', { priority: dto.priority });
    }
    if (dto.after) {
      qb.andWhere('n.createdAt > :after', { after: dto.after });
    }
    if (dto.before) {
      qb.andWhere('n.createdAt < :before', { before: dto.before });
    }

    // Cursor-based pagination
    if (dto.cursor) {
      const decoded = Buffer.from(dto.cursor, 'base64').toString('utf8');
      try {
        const { createdAt, id } = JSON.parse(decoded);
        qb.andWhere(
          '(n.createdAt < :cursorCreatedAt OR (n.createdAt = :cursorCreatedAt AND n.id < :cursorId))',
          { cursorCreatedAt: createdAt, cursorId: id },
        );
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const sortOrder = dto.sortOrder || 'DESC';
    const sortBy = dto.sortBy || 'createdAt';
    qb.orderBy(`n.${sortBy}`, sortOrder).addOrderBy('n.id', sortOrder);

    // Fetch one extra to determine if there are more results
    const limit = dto.limit || 20;
    qb.take(limit + 1);

    const results = await qb.getMany();
    const hasMore = results.length > limit;
    if (hasMore) results.pop();

    const nextCursor =
      hasMore && results.length > 0
        ? Buffer.from(
            JSON.stringify({
              createdAt: results[results.length - 1].createdAt,
              id: results[results.length - 1].id,
            }),
          ).toString('base64')
        : null;

    const total = await qb.getCount();

    return { data: results, total, nextCursor };
  }

  /**
   * Get a single notification by ID.
   */
  async getById(notificationId: string): Promise<Notification> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    return notification;
  }

  /**
   * Mark one or more notifications as read.
   */
  async markAsRead(notificationIds: string[]): Promise<{ updated: number }> {
    const result = await this.notificationRepo
      .createQueryBuilder()
      .update()
      .set({ read: true, readAt: new Date() })
      .where('id IN (:...ids)', { ids: notificationIds })
      .andWhere('read = false')
      .execute();

    this.logger.log(`Marked ${result.affected} notifications as read`);
    return { updated: result.affected || 0 };
  }

  /**
   * Mark all notifications as read for a user (optionally filtered by category or time).
   */
  async markAllAsRead(
    userId: string,
    options?: { category?: string; before?: string },
  ): Promise<{ updated: number }> {
    const qb = this.notificationRepo
      .createQueryBuilder()
      .update()
      .set({ read: true, readAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('read = false');

    if (options?.category) {
      qb.andWhere('category = :category', { category: options.category });
    }
    if (options?.before) {
      qb.andWhere('createdAt <= :before', { before: options.before });
    }

    const result = await qb.execute();
    this.logger.log(`Marked ${result.affected} notifications as read for user ${userId}`);
    return { updated: result.affected || 0 };
  }

  /**
   * Mark one or more notifications as unread.
   */
  async markAsUnread(notificationIds: string[]): Promise<{ updated: number }> {
    const result = await this.notificationRepo
      .createQueryBuilder()
      .update()
      .set({ read: false, readAt: null })
      .where('id IN (:...ids)', { ids: notificationIds })
      .andWhere('read = true')
      .execute();

    return { updated: result.affected || 0 };
  }

  /**
   * Track notification click-through.
   */
  async trackClick(notificationId: string): Promise<void> {
    await this.notificationRepo.update(notificationId, {
      clicked: true,
      clickedAt: new Date(),
    });
    // Update delivery log
    await this.deliveryLogRepo.update(
      { notificationId },
      { status: DeliveryStatus.CLICKED, clickedAt: new Date() },
    );
  }

  /**
   * Soft-delete notifications.
   */
  async softDelete(notificationIds: string[]): Promise<{ deleted: number }> {
    const result = await this.notificationRepo
      .createQueryBuilder()
      .update()
      .set({ deleted: true })
      .where('id IN (:...ids)', { ids: notificationIds })
      .execute();

    return { deleted: result.affected || 0 };
  }

  /**
   * Get unread count for a user, optionally filtered by category.
   */
  async getUnreadCount(
    userId: string,
    category?: string,
  ): Promise<{ total: number; byCategory: Record<string, number> }> {
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .select('n.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('n.userId = :userId', { userId })
      .andWhere('n.read = false')
      .andWhere('n.deleted = false');

    if (category) {
      qb.andWhere('n.category = :category', { category });
    }

    qb.groupBy('n.category');
    const rows = await qb.getRawMany();

    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const count = parseInt(row.count, 10);
      byCategory[row.category] = count;
      total += count;
    }

    return { total, byCategory };
  }

  /**
   * Get delivery status for a specific notification.
   */
  async getDeliveryStatus(
    notificationId: string,
  ): Promise<NotificationDeliveryLog[]> {
    return this.deliveryLogRepo.find({
      where: { notificationId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Emit a real-time event when a new in-app notification is created.
   */
  private emitRealtimeEvent(notification: Notification): void {
    this.eventEmitter.emit('notification.new', {
      userId: notification.userId,
      notification,
    });
  }

  private priorityToNumber(priority: string): number {
    const map: Record<string, number> = {
      critical: 1,
      high: 2,
      normal: 3,
      low: 4,
    };
    return map[priority] || 3;
  }
}
