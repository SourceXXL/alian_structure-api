import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannelProvider,
  ChannelDeliveryPayload,
  ChannelDeliveryResult,
} from './notification-channel.interface';
import { NotificationChannel } from '../entities/notification.entity';
import { DeliveryStatus } from '../entities/notification-delivery-log.entity';

@Injectable()
export class PushNotificationProvider implements NotificationChannelProvider {
  readonly channel = NotificationChannel.PUSH;
  private readonly logger = new Logger(PushNotificationProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async deliver(payload: ChannelDeliveryPayload): Promise<ChannelDeliveryResult> {
    this.logger.log(
      `Delivering push notification ${payload.notificationId} to ${payload.recipientAddress}`,
    );

    try {
      // In production, this would use FCM (Firebase Cloud Messaging) or APNs
      const pushPayload = {
        token: payload.recipientAddress,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.metadata || {},
        priority: payload.priority === 'high' || payload.priority === 'critical' ? 'high' : 'normal',
      };

      this.logger.log(
        `Push notification queued: "${payload.title}" to device ${payload.recipientAddress.substring(0, 12)}...`,
      );

      return {
        status: DeliveryStatus.SENT,
        provider: 'push',
        providerMessageId: `push_${payload.notificationId}_${Date.now()}`,
        providerResponse: pushPayload,
      };
    } catch (error) {
      this.logger.error(
        `Push delivery failed for ${payload.notificationId}: ${error.message}`,
      );
      return {
        status: DeliveryStatus.FAILED,
        errorMessage: error.message,
        provider: 'push',
      };
    }
  }

  async validate(): Promise<boolean> {
    return Boolean(
      this.configService.get<string>('FCM_PROJECT_ID') ||
        this.configService.get<string>('FCM_PRIVATE_KEY') ||
        this.configService.get<string>('PUSH_PROVIDER'),
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      return this.validate();
    } catch {
      return false;
    }
  }
}
