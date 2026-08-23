import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationChannel, NotificationStatus } from '../entities/notification.entity';
import { NotificationDeliveryLog, DeliveryStatus } from '../entities/notification-delivery-log.entity';
import { NotificationPreference, NotificationChannelPreference } from '../entities/notification-preference.entity';
import { NotificationChannelProvider } from '../providers/notification-channel.interface';

interface NotificationJobData {
  notificationId: string;
}

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  private providers = new Map<NotificationChannel, NotificationChannelProvider>();

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(NotificationDeliveryLog)
    private readonly deliveryLogRepo: Repository<NotificationDeliveryLog>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    // Providers injected via registerProvider
  ) {}

  /**
   * Register a channel provider (called by the module on init).
   */
  registerProvider(provider: NotificationChannelProvider): void {
    this.providers.set(provider.channel, provider);
  }

  @Process('process-notification')
  async processNotification(job: Job<NotificationJobData>): Promise<void> {
    const { notificationId } = job.data;
    this.logger.log(`Processing notification: ${notificationId}`);

    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });
    if (!notification) {
      this.logger.warn(`Notification not found: ${notificationId}`);
      return;
    }

    if (notification.status === NotificationStatus.CANCELLED) {
      this.logger.log(`Notification cancelled, skipping: ${notificationId}`);
      return;
    }

    // Mark as sending
    await this.notificationRepo.update(notificationId, {
      status: NotificationStatus.SENDING,
      attemptCount: notification.attemptCount + 1,
    });

    const channels = notification.channels || [notification.primaryChannel];

    for (const channel of channels) {
      // Check user preferences
      const preference = await this.preferenceRepo.findOne({
        where: {
          userId: notification.userId,
          channel,
          category: notification.category,
        },
      });

      // Skip if the user has disabled this channel
      if (preference && preference.preference === NotificationChannelPreference.DISABLED) {
        this.logger.debug(
          `Skipping ${channel} for user ${notification.userId}: channel disabled`,
        );
        continue;
      }

      // Check quiet hours
      if (preference?.quietHoursStart !== null && preference?.quietHoursEnd !== null) {
        const userHour = this.getUserLocalHour(preference.timezone);
        if (userHour !== null &&
          preference.quietHoursStart !== null &&
          preference.quietHoursEnd !== null &&
          userHour >= preference.quietHoursStart &&
          userHour < preference.quietHoursEnd) {
          this.logger.debug(
            `Skipping ${channel} for user ${notification.userId}: quiet hours`,
          );
          continue;
        }
      }

      // Check minimum priority
      if (preference?.minPriority && preference.minPriority !== 'low') {
        const priorityOrder = ['low', 'normal', 'high', 'critical'];
        const minIdx = priorityOrder.indexOf(preference.minPriority);
        const notifIdx = priorityOrder.indexOf(notification.priority);
        if (notifIdx < minIdx) {
          this.logger.debug(
            `Skipping ${channel} for user ${notification.userId}: priority below threshold`,
          );
          continue;
        }
      }

      // Resolve provider
      const provider = this.providers.get(channel);
      if (!provider) {
        this.logger.warn(`No provider registered for channel ${channel}`);
        continue;
      }

      // Resolve recipient address from preferences
      const recipientAddress = this.resolveRecipientAddress(preference, channel);
      if (!recipientAddress) {
        this.logger.warn(
          `No recipient address for user ${notification.userId} on channel ${channel}`,
        );
        continue;
      }

      // Create delivery log entry
      const deliveryLog = this.deliveryLogRepo.create({
        notificationId,
        userId: notification.userId,
        channel,
        status: DeliveryStatus.PENDING,
        maxAttempts: notification.maxAttempts,
      });
      const savedLog = await this.deliveryLogRepo.save(deliveryLog);

      // Deliver
      try {
        const result = await provider.deliver({
          notificationId,
          userId: notification.userId,
          channel,
          title: notification.title,
          body: notification.body,
          htmlBody: notification.htmlBody,
          recipientAddress,
          metadata: notification.metadata,
          priority: notification.priority,
        });

        await this.deliveryLogRepo.update(savedLog.id, {
          status: result.status,
          providerMessageId: result.providerMessageId,
          provider: result.provider,
          providerResponse: result.providerResponse,
          errorMessage: result.errorMessage,
          sentAt: result.status === DeliveryStatus.SENT ? new Date() : undefined,
          deliveredAt: result.status === DeliveryStatus.DELIVERED ? new Date() : undefined,
        });
      } catch (error) {
        await this.deliveryLogRepo.update(savedLog.id, {
          status: DeliveryStatus.FAILED,
          errorMessage: error.message,
        });
      }
    }

    // Update notification status
    const allLogs = await this.deliveryLogRepo.find({
      where: { notificationId },
    });
    const allDelivered = allLogs.length > 0 && allLogs.every(l =>
      l.status === DeliveryStatus.DELIVERED || l.status === DeliveryStatus.SENT,
    );
    const anyFailed = allLogs.some(l => l.status === DeliveryStatus.FAILED);

    const newStatus = allDelivered
      ? NotificationStatus.DELIVERED
      : anyFailed && notification.attemptCount >= notification.maxAttempts
        ? NotificationStatus.FAILED
        : NotificationStatus.QUEUED;

    await this.notificationRepo.update(notificationId, {
      status: newStatus,
      sentAt: new Date(),
      deliveredAt: allDelivered ? new Date() : undefined,
    });
  }

  @OnQueueFailed()
  onJobFailed(job: Job<NotificationJobData>, error: Error): void {
    this.logger.error(
      `Notification job ${job.id} failed for ${job.data.notificationId}: ${error.message}`,
    );
  }

  @OnQueueCompleted()
  onJobCompleted(job: Job<NotificationJobData>): void {
    this.logger.log(`Notification job ${job.id} completed for ${job.data.notificationId}`);
  }

  private resolveRecipientAddress(
    preference: NotificationPreference | null,
    channel: NotificationChannel,
  ): string | null {
    if (!preference) return null;
    switch (channel) {
      case NotificationChannel.EMAIL:
        return preference.emailAddress || null;
      case NotificationChannel.SMS:
        return preference.phoneNumber || null;
      case NotificationChannel.PUSH:
        return preference.pushToken || null;
      case NotificationChannel.WEBHOOK:
        return preference.webhookUrl || null;
      case NotificationChannel.IN_APP:
        return preference.userId || null;
      default:
        return null;
    }
  }

  private getUserLocalHour(timezone?: string | null): number | null {
    if (!timezone) return null;
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      });
      return parseInt(formatter.format(now), 10);
    } catch {
      return null;
    }
  }
}
