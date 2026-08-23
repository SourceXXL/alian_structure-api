import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannelProvider,
  ChannelDeliveryPayload,
  ChannelDeliveryResult,
} from './notification-channel.interface';
import { NotificationChannel } from '../entities/notification.entity';
import { DeliveryStatus } from '../entities/notification-delivery-log.entity';
import * as crypto from 'crypto';

@Injectable()
export class WebhookNotificationProvider implements NotificationChannelProvider {
  readonly channel = NotificationChannel.WEBHOOK;
  private readonly logger = new Logger(WebhookNotificationProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async deliver(payload: ChannelDeliveryPayload): Promise<ChannelDeliveryResult> {
    this.logger.log(
      `Delivering webhook notification ${payload.notificationId} to ${payload.recipientAddress}`,
    );

    try {
      const webhookUrl = payload.recipientAddress;
      const signingKey =
        payload.metadata?.signingKey ||
        this.configService.get<string>('WEBHOOK_SIGNING_KEY', '');

      const webhookPayload = JSON.stringify({
        event: 'notification',
        notificationId: payload.notificationId,
        userId: payload.userId,
        title: payload.title,
        body: payload.body,
        htmlBody: payload.htmlBody,
        priority: payload.priority,
        timestamp: new Date().toISOString(),
        metadata: payload.metadata,
      });

      // Generate HMAC signature for webhook security
      const signature = signingKey
        ? crypto.createHmac('sha256', signingKey).update(webhookPayload).digest('hex')
        : undefined;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Notification-ID': payload.notificationId,
        'X-Timestamp': new Date().toISOString(),
      };
      if (signature) {
        headers['X-Signature-256'] = `sha256=${signature}`;
      }

      // In production, this would use axios to POST to the webhook URL
      this.logger.log(
        `Webhook queued: POST to ${webhookUrl} with ${headers['X-Signature-256'] ? 'HMAC signature' : 'no signature'}`,
      );

      return {
        status: DeliveryStatus.SENT,
        provider: 'webhook',
        providerMessageId: `webhook_${payload.notificationId}_${Date.now()}`,
        providerResponse: {
          url: webhookUrl,
          method: 'POST',
          headers,
          payloadSize: webhookPayload.length,
        },
      };
    } catch (error) {
      this.logger.error(
        `Webhook delivery failed for ${payload.notificationId}: ${error.message}`,
      );
      return {
        status: DeliveryStatus.FAILED,
        errorMessage: error.message,
        provider: 'webhook',
      };
    }
  }

  async validate(): Promise<boolean> {
    // Webhooks are always "valid" since they use user-provided URLs
    return true;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
