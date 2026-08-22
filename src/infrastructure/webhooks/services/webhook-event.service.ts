import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import {
  WebhookEvent,
  WebhookEventStatus,
} from "../entities/webhook-event.entity";
import { WebhookSubscriptionService } from "./webhook-subscription.service";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import { PublishWebhookEventDto } from "../dto/webhook.dto";

@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly eventRepo: Repository<WebhookEvent>,
    private readonly subscriptionService: WebhookSubscriptionService,
    private readonly deliveryService: WebhookDeliveryService,
    @InjectQueue("webhook-delivery") private readonly deliveryQueue: Queue,
  ) {}

  /**
   * Publish a new webhook event. Matches active subscribers, creates delivery
   * records, and enqueues each delivery for async processing.
   */
  async publishEvent(dto: PublishWebhookEventDto): Promise<WebhookEvent> {
    // Persist the event
    const event = this.eventRepo.create({
      eventType: dto.eventType,
      payload: dto.payload,
      aggregateId: dto.aggregateId,
      metadata: dto.metadata,
      status: WebhookEventStatus.PENDING,
    });
    const saved = await this.eventRepo.save(event);
    this.logger.log(`Event published: ${saved.id} type=${saved.eventType}`);

    // Find matching subscribers
    const subscribers = await this.subscriptionService.findActiveForEvent(
      dto.eventType,
    );

    if (subscribers.length === 0) {
      this.logger.log(
        `No active subscribers for event type "${dto.eventType}"`,
      );
      saved.status = WebhookEventStatus.DELIVERED;
      saved.deliveryCount = 0;
      await this.eventRepo.save(saved);
      return saved;
    }

    // Create delivery records
    const deliveries = await this.deliveryService.createDeliveries(
      saved,
      subscribers,
    );

    // Enqueue each delivery
    for (const delivery of deliveries) {
      await this.deliveryQueue.add(
        "deliver",
        {
          deliveryId: delivery.id,
          eventId: saved.id,
        },
        {
          attempts: 1, // We handle retries ourselves via backoff
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    }

    saved.status = WebhookEventStatus.DELIVERING;
    saved.deliveryCount = deliveries.length;
    await this.eventRepo.save(saved);

    this.logger.log(
      `Event ${saved.id} enqueued for ${deliveries.length} subscribers`,
    );

    return saved;
  }

  /**
   * Get event by ID with delivery details.
   */
  async getEvent(eventId: string): Promise<WebhookEvent | null> {
    return this.eventRepo.findOne({ where: { id: eventId } });
  }

  /**
   * List recent events with optional type filter.
   */
  async listEvents(
    eventType?: string,
    limit = 50,
    offset = 0,
  ): Promise<WebhookEvent[]> {
    const where: any = {};
    if (eventType) where.eventType = eventType;
    return this.eventRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Replay an event — re-publishes it to all current matching subscribers.
   */
  async replayEvent(eventId: string): Promise<WebhookEvent | null> {
    const original = await this.eventRepo.findOne({
      where: { id: eventId },
    });
    if (!original) return null;

    return this.publishEvent({
      eventType: original.eventType,
      payload: original.payload,
      aggregateId: original.aggregateId,
      metadata: { ...original.metadata, replayedFrom: original.id },
    });
  }
}
