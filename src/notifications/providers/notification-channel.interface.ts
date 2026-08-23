import { NotificationChannel } from '../entities/notification.entity';
import { DeliveryStatus } from '../entities/notification-delivery-log.entity';

/**
 * Result of a channel delivery attempt.
 */
export interface ChannelDeliveryResult {
  status: DeliveryStatus;
  providerMessageId?: string;
  provider?: string;
  providerResponse?: Record<string, any>;
  errorMessage?: string;
}

/**
 * Payload sent to a channel provider for delivery.
 */
export interface ChannelDeliveryPayload {
  notificationId: string;
  userId: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  htmlBody?: string;
  /** Resolved contact info (email address, phone number, etc.) */
  recipientAddress: string;
  /** Metadata for the channel provider */
  metadata?: Record<string, any>;
  priority?: string;
}

/**
 * Interface that all notification channel providers must implement.
 * Follows the Strategy pattern to abstract different delivery mechanisms.
 */
export interface NotificationChannelProvider {
  readonly channel: NotificationChannel;

  /**
   * Attempt to deliver a notification through this channel.
   */
  deliver(payload: ChannelDeliveryPayload): Promise<ChannelDeliveryResult>;

  /**
   * Validate that the provider is properly configured and can deliver.
   */
  validate(): Promise<boolean>;

  /**
   * Health check for this provider.
   */
  healthCheck(): Promise<boolean>;
}
