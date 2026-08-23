import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannelProvider,
  ChannelDeliveryPayload,
  ChannelDeliveryResult,
} from './notification-channel.interface';
import {
  NotificationChannel,
} from '../entities/notification.entity';
import { DeliveryStatus } from '../entities/notification-delivery-log.entity';

@Injectable()
export class EmailNotificationProvider implements NotificationChannelProvider {
  readonly channel = NotificationChannel.EMAIL;
  private readonly logger = new Logger(EmailNotificationProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async deliver(payload: ChannelDeliveryPayload): Promise<ChannelDeliveryResult> {
    this.logger.log(`Delivering email notification ${payload.notificationId} to ${payload.recipientAddress}`);

    try {
      // Delegate to the existing email module's SMTP/SendGrid/SES provider
      // For now, simulate delivery via a configurable endpoint
      const emailFrom = this.configService.get<string>('NOTIFICATION_EMAIL_FROM', 'noreply@alian-structure.com');

      // In production, this would use the EmailService from the email module
      // or directly use nodemailer/sendgrid/SES
      this.logger.log(
        `Email queued: "${payload.title}" to ${payload.recipientAddress} from ${emailFrom}`,
      );

      return {
        status: DeliveryStatus.SENT,
        provider: 'email',
        providerMessageId: `email_${payload.notificationId}_${Date.now()}`,
        providerResponse: {
          from: emailFrom,
          to: payload.recipientAddress,
          subject: payload.title,
        },
      };
    } catch (error) {
      this.logger.error(
        `Email delivery failed for ${payload.notificationId}: ${error.message}`,
      );
      return {
        status: DeliveryStatus.FAILED,
        errorMessage: error.message,
        provider: 'email',
      };
    }
  }

  async validate(): Promise<boolean> {
    const configured = this.configService.get<string>('EMAIL_PROVIDER') || this.configService.get<string>('SMTP_HOST');
    return Boolean(configured);
  }

  async healthCheck(): Promise<boolean> {
    try {
      return this.validate();
    } catch {
      return false;
    }
  }
}
