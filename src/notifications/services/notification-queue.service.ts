import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationQueue: Queue,
  ) {}

  /**
   * Enqueue a notification for async processing.
   */
  async enqueueNotification(
    notificationId: string,
    options?: { delay?: number; priority?: number },
  ): Promise<void> {
    const jobOptions: any = {
      removeOnComplete: 100,
      removeOnFail: 500,
    };

    if (options?.delay) {
      jobOptions.delay = options.delay;
    }
    if (options?.priority !== undefined) {
      jobOptions.priority = options.priority;
    }

    await this.notificationQueue.add('process-notification', { notificationId }, jobOptions);
    this.logger.log(`Notification enqueued: ${notificationId}`);
  }

  /**
   * Enqueue a scheduled notification for future delivery.
   */
  async enqueueScheduledNotification(
    notificationId: string,
    scheduledAt: Date,
  ): Promise<void> {
    const delay = scheduledAt.getTime() - Date.now();
    if (delay <= 0) {
      // Already past due — process immediately
      await this.enqueueNotification(notificationId);
      return;
    }

    await this.notificationQueue.add(
      'process-notification',
      { notificationId },
      {
        delay,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.logger.log(
      `Notification scheduled: ${notificationId} for ${scheduledAt.toISOString()} (delay: ${delay}ms)`,
    );
  }

  /**
   * Cancel a pending scheduled notification.
   */
  async cancelNotification(notificationId: string): Promise<boolean> {
    const jobs = await this.notificationQueue.getJobs(['delayed', 'waiting', 'active']);
    for (const job of jobs) {
      if (job.data?.notificationId === notificationId) {
        await job.remove();
        this.logger.log(`Notification cancelled: ${notificationId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Get queue metrics.
   */
  async getQueueMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.notificationQueue.getWaitingCount(),
      this.notificationQueue.getActiveCount(),
      this.notificationQueue.getCompletedCount(),
      this.notificationQueue.getFailedCount(),
      this.notificationQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Retry failed jobs.
   */
  async retryFailed(): Promise<number> {
    const failedJobs = await this.notificationQueue.getFailed();
    let retried = 0;
    for (const job of failedJobs) {
      await job.retry();
      retried++;
    }
    this.logger.log(`Retried ${retried} failed notification jobs`);
    return retried;
  }
}
