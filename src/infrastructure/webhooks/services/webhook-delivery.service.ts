import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "../entities/webhook-delivery.entity";
import { WebhookDeadLetter } from "../entities/webhook-dead-letter.entity";
import {
  WebhookSubscription,
  WebhookSubscriptionStatus,
} from "../entities/webhook-subscription.entity";
import { WebhookEvent } from "../entities/webhook-event.entity";
import { WebhookHmacService } from "./webhook-hmac.service";

export interface DeliveryResult {
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
  error?: string;
  responseHeaders?: Record<string, string>;
}

export interface WebhookMetrics {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  deadLetteredCount: number;
  pendingRetries: number;
  avgDurationMs: number;
  deliveriesByEvent: Record<
    string,
    { total: number; success: number; failed: number }
  >;
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookDeadLetter)
    private readonly deadLetterRepo: Repository<WebhookDeadLetter>,
    @InjectRepository(WebhookEvent)
    private readonly eventRepo: Repository<WebhookEvent>,
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    private readonly httpService: HttpService,
    private readonly hmacService: WebhookHmacService,
  ) {}

  /**
   * Create delivery records for an event against all matching subscriptions.
   */
  async createDeliveries(
    event: WebhookEvent,
    subscriptions: WebhookSubscription[],
  ): Promise<WebhookDelivery[]> {
    const deliveries: WebhookDelivery[] = [];
    for (const sub of subscriptions) {
      const delivery = this.deliveryRepo.create({
        subscriptionId: sub.id,
        eventId: event.id,
        status: WebhookDeliveryStatus.PENDING,
        maxAttempts: sub.maxRetries,
      });
      const saved = await this.deliveryRepo.save(delivery);
      deliveries.push(saved);
    }
    return deliveries;
  }

  /**
   * Execute a single delivery attempt with HMAC signing.
   */
  async executeDelivery(delivery: WebhookDelivery): Promise<DeliveryResult> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id: delivery.subscriptionId },
    });
    const event = await this.eventRepo.findOne({
      where: { id: delivery.eventId },
    });
    if (!subscription || !event) {
      return {
        durationMs: 0,
        error: "Subscription or event not found",
      };
    }

    const payload = JSON.stringify({
      id: event.id,
      type: event.eventType,
      aggregateId: event.aggregateId,
      data: event.payload,
      timestamp: new Date().toISOString(),
      attempt: delivery.attempts + 1,
    });

    const headers = this.hmacService.buildSignedHeaders(
      subscription.signingKey,
      payload,
      event.id,
      event.eventType,
      subscription.headers,
    );

    // Update delivery status to delivering
    delivery.status = WebhookDeliveryStatus.DELIVERING;
    delivery.requestHeaders = headers;
    delivery.lastAttemptAt = new Date();
    await this.deliveryRepo.save(delivery);

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(subscription.url, payload, {
          headers,
          timeout: subscription.timeoutMs || 30000,
          validateStatus: () => true, // Don't throw for 4xx/5xx
        }),
      );

      const durationMs = Date.now() - startTime;
      const statusCode = response.status;
      const responseBody =
        typeof response.data === "string"
          ? response.data.substring(0, 10000)
          : JSON.stringify(response.data).substring(0, 10000);

      const respHeaders: Record<string, string> = {};
      if (response.headers) {
        for (const [k, v] of Object.entries(response.headers)) {
          if (typeof v === "string") respHeaders[k] = v;
        }
      }

      const isSuccess = statusCode >= 200 && statusCode < 300;
      return {
        statusCode,
        responseBody,
        durationMs,
        responseHeaders: respHeaders,
        error: isSuccess ? undefined : `HTTP ${statusCode}`,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return {
        durationMs,
        error: err.message || "Unknown delivery error",
      };
    }
  }

  /**
   * Process a delivery: attempt, retry on failure, or dead-letter.
   */
  async processDelivery(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
    });
    if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);

    const subscription = await this.subscriptionRepo.findOne({
      where: { id: delivery.subscriptionId },
    });
    if (!subscription)
      throw new Error(`Subscription ${delivery.subscriptionId} not found`);

    const result = await this.executeDelivery(delivery);
    const attemptNum = delivery.attempts + 1;
    const isSuccess =
      result.statusCode !== undefined &&
      result.statusCode >= 200 &&
      result.statusCode < 300;

    // Record attempt in metadata
    const attempts = (delivery.metadata?.attempts as any[]) || [];
    attempts.push({
      attempt: attemptNum,
      statusCode: result.statusCode,
      error: result.error,
      durationMs: result.durationMs,
      timestamp: new Date().toISOString(),
    });

    if (isSuccess) {
      delivery.status = WebhookDeliveryStatus.SUCCESS;
      delivery.statusCode = result.statusCode;
      delivery.durationMs = result.durationMs;
      delivery.deliveredAt = new Date();
      delivery.responseBody = result.responseBody;
      delivery.responseHeaders = result.responseHeaders;
      delivery.attempts = attemptNum;
      delivery.metadata = { ...delivery.metadata, attempts };
      await this.deliveryRepo.save(delivery);

      // Update event success count
      await this.eventRepo
        .createQueryBuilder()
        .update(WebhookEvent)
        .set({ successCount: () => '"successCount" + 1' })
        .where("id = :id", { id: delivery.eventId })
        .execute();

      this.logger.log(
        `Delivery ${deliveryId} succeeded: HTTP ${result.statusCode} in ${result.durationMs}ms`,
      );
    } else {
      delivery.attempts = attemptNum;
      delivery.statusCode = result.statusCode;
      delivery.durationMs = result.durationMs;
      delivery.errorMessage = result.error;
      delivery.responseBody = result.responseBody;
      delivery.responseHeaders = result.responseHeaders;
      delivery.metadata = { ...delivery.metadata, attempts };

      if (attemptNum >= delivery.maxAttempts) {
        // Dead-letter
        delivery.status = WebhookDeliveryStatus.DEAD_LETTERED;
        await this.deliveryRepo.save(delivery);

        const event = await this.eventRepo.findOne({
          where: { id: delivery.eventId },
        });

        await this.deadLetterRepo.save(
          this.deadLetterRepo.create({
            deliveryId: delivery.id,
            subscriptionId: delivery.subscriptionId,
            eventId: delivery.eventId,
            url: subscription.url,
            eventPayload: event?.payload || {},
            requestHeaders: delivery.requestHeaders || {},
            lastStatusCode: result.statusCode,
            lastErrorMessage: result.error,
            totalAttempts: attemptNum,
            userId: subscription.userId,
            allAttempts: attempts,
          }),
        );

        // Update event failure count
        await this.eventRepo
          .createQueryBuilder()
          .update(WebhookEvent)
          .set({ failureCount: () => '"failureCount" + 1' })
          .where("id = :id", { id: delivery.eventId })
          .execute();

        this.logger.warn(
          `Delivery ${deliveryId} dead-lettered after ${attemptNum} attempts`,
        );
      } else {
        // Schedule retry
        const delay = this.calculateRetryDelay(
          subscription.retryDelayMs,
          subscription.backoffMultiplier,
          attemptNum,
        );
        delivery.status = WebhookDeliveryStatus.FAILED;
        delivery.nextRetryAt = new Date(Date.now() + delay);
        await this.deliveryRepo.save(delivery);

        this.logger.log(
          `Delivery ${deliveryId} attempt ${attemptNum}/${delivery.maxAttempts} failed, retry in ${delay}ms`,
        );
      }
    }

    return delivery;
  }

  /**
   * Calculate exponential backoff delay with jitter.
   */
  calculateRetryDelay(
    baseDelayMs: number,
    multiplier: number,
    attempt: number,
  ): number {
    const exponential = baseDelayMs * Math.pow(multiplier, attempt - 1);
    const jitter = exponential * 0.2 * Math.random();
    return Math.min(exponential + jitter, 300000); // Cap at 5 minutes
  }

  /**
   * Get all deliveries for a given event.
   */
  async getDeliveriesByEvent(eventId: string): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { eventId },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Get pending deliveries that are due for retry.
   */
  async getPendingRetries(): Promise<WebhookDeadLetter[]> {
    return this.deadLetterRepo.find({
      where: { retried: false },
      order: { createdAt: "ASC" },
      take: 50,
    });
  }

  /**
   * Reattempt a dead-lettered delivery.
   */
  async retryDeadLetter(deadLetterId: string): Promise<WebhookDelivery | null> {
    const dl = await this.deadLetterRepo.findOne({
      where: { id: deadLetterId },
    });
    if (!dl || dl.retried) return null;

    const subscription = await this.subscriptionRepo.findOne({
      where: { id: dl.subscriptionId },
    });
    if (
      !subscription ||
      subscription.status !== WebhookSubscriptionStatus.ACTIVE
    ) {
      return null;
    }

    // Create a fresh delivery
    const newDelivery = this.deliveryRepo.create({
      subscriptionId: dl.subscriptionId,
      eventId: dl.eventId,
      status: WebhookDeliveryStatus.PENDING,
      maxAttempts: subscription.maxRetries,
    });
    const saved = await this.deliveryRepo.save(newDelivery);

    dl.retried = true;
    await this.deadLetterRepo.save(dl);

    this.logger.log(
      `Dead letter ${deadLetterId} requeued as delivery ${saved.id}`,
    );
    return saved;
  }

  /**
   * Get dead-lettered deliveries with optional filters.
   */
  async getDeadLetters(
    userId?: string,
    limit = 50,
    offset = 0,
  ): Promise<WebhookDeadLetter[]> {
    const where: any = {};
    if (userId) where.userId = userId;
    return this.deadLetterRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get aggregated webhook delivery metrics.
   */
  async getMetrics(userId?: string): Promise<WebhookMetrics> {
    const deliveries = userId
      ? await this.deliveryRepo
          .createQueryBuilder("d")
          .innerJoin("d.subscriptionId", "s")
          .innerJoin(
            WebhookSubscription,
            "sub",
            "sub.id = d.subscriptionId AND sub.userId = :userId",
            { userId },
          )
          .getMany()
      : await this.deliveryRepo.find();

    const deadLetters = await this.deadLetterRepo.find({
      where: userId ? { userId } : {},
    });

    const totalDeliveries = deliveries.length;
    const successfulDeliveries = deliveries.filter(
      (d) => d.status === WebhookDeliveryStatus.SUCCESS,
    ).length;
    const failedDeliveries = deliveries.filter(
      (d) => d.status === WebhookDeliveryStatus.FAILED,
    ).length;
    const pendingRetries = deliveries.filter(
      (d) =>
        d.status === WebhookDeliveryStatus.FAILED &&
        d.nextRetryAt &&
        d.nextRetryAt > new Date(),
    ).length;

    const durations = deliveries
      .filter((d) => d.durationMs > 0)
      .map((d) => d.durationMs);
    const avgDurationMs =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    // Group by event type via the event entity
    const deliveriesByEvent: Record<
      string,
      { total: number; success: number; failed: number }
    > = {};
    for (const d of deliveries) {
      const event = await this.eventRepo.findOne({ where: { id: d.eventId } });
      const type = event?.eventType || "unknown";
      if (!deliveriesByEvent[type]) {
        deliveriesByEvent[type] = { total: 0, success: 0, failed: 0 };
      }
      deliveriesByEvent[type].total++;
      if (d.status === WebhookDeliveryStatus.SUCCESS)
        deliveriesByEvent[type].success++;
      if (d.status === WebhookDeliveryStatus.FAILED)
        deliveriesByEvent[type].failed++;
    }

    return {
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      deadLetteredCount: deadLetters.length,
      pendingRetries,
      avgDurationMs: Math.round(avgDurationMs),
      deliveriesByEvent,
    };
  }
}
