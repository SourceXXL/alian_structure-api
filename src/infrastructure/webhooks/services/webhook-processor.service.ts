import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { WebhookDeliveryService } from "./webhook-delivery.service";

export interface WebhookDeliveryJobData {
  deliveryId: string;
  eventId: string;
}

@Processor("webhook-delivery")
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly deliveryService: WebhookDeliveryService) {}

  @Process("deliver")
  async handleDelivery(job: Job<WebhookDeliveryJobData>) {
    const { deliveryId } = job.data;
    this.logger.log(
      `Processing webhook delivery job ${job.id} for delivery ${deliveryId}`,
    );

    try {
      const delivery = await this.deliveryService.processDelivery(deliveryId);
      return {
        status: delivery.status,
        deliveryId: delivery.id,
        attempts: delivery.attempts,
        statusCode: delivery.statusCode,
        durationMs: delivery.durationMs,
      };
    } catch (err: any) {
      this.logger.error(
        `Webhook delivery job ${job.id} failed: ${err.message}`,
      );
      throw err;
    }
  }
}
