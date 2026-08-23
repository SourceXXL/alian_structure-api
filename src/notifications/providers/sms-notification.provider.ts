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
export class SmsNotificationProvider implements NotificationChannelProvider {
  readonly channel = NotificationChannel.SMS;
  private readonly logger = new Logger(SmsNotificationProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async deliver(payload: ChannelDeliveryPayload): Promise<ChannelDeliveryResult> {
    this.logger.log(
      `Delivering SMS notification ${payload.notificationId} to ${payload.recipientAddress}`,
    );

    try {
      // In production, this would use Twilio, AWS SNS, or similar
      const smsBody = payload.body.length > 160
        ? payload.body.substring(0, 157) + '...'
        : payload.body;

      this.logger.log(
        `SMS queued: "${smsBody}" to ${payload.recipientAddress}`,
      );

      return {
        status: DeliveryStatus.SENT,
        provider: 'sms',
        providerMessageId: `sms_${payload.notificationId}_${Date.now()}`,
        providerResponse: {
          to: payload.recipientAddress,
          body: smsBody,
          charsUsed: smsBody.length,
        },
      };
    } catch (error) {
      this.logger.error(
        `SMS delivery failed for ${payload.notificationId}: ${error.message}`,
      );
      return {
        status: DeliveryStatus.FAILED,
        errorMessage: error.message,
        provider: 'sms',
      };
    }
  }

  async validate(): Promise<boolean> {
    // SMS requires a configured provider (Twilio, etc.)
    return Boolean(
      this.configService.get<string>('TWILIO_ACCOUNT_SID') ||
        this.configService.get<string>('SMS_PROVIDER'),
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
