import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomBytes } from "crypto";
import {
  WebhookSubscription,
  WebhookSubscriptionStatus,
} from "../entities/webhook-subscription.entity";
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
} from "../dto/webhook.dto";

@Injectable()
export class WebhookSubscriptionService {
  private readonly logger = new Logger(WebhookSubscriptionService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
  ) {}

  async create(
    userId: string,
    dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscription & { signingKey: string }> {
    const signingKey = this.generateSigningKey();
    const subscription = this.subscriptionRepo.create({
      userId,
      url: dto.url,
      signingKey,
      events: dto.events,
      description: dto.description,
      maxRetries: dto.maxRetries ?? 5,
      retryDelayMs: dto.retryDelayMs ?? 1000,
      backoffMultiplier: dto.backoffMultiplier ?? 2,
      timeoutMs: dto.timeoutMs ?? 30000,
      rateLimitPerMinute: dto.rateLimitPerMinute ?? 10,
      headers: dto.headers,
      metadata: dto.metadata,
      status: WebhookSubscriptionStatus.ACTIVE,
    });
    const saved = await this.subscriptionRepo.save(subscription);
    this.logger.log(
      `Webhook subscription created: ${saved.id} for user ${userId}, url=${dto.url}`,
    );
    return { ...saved, signingKey };
  }

  async findAll(userId: string): Promise<WebhookSubscription[]> {
    return this.subscriptionRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: string, userId: string): Promise<WebhookSubscription> {
    const sub = await this.subscriptionRepo.findOne({
      where: { id, userId },
    });
    if (!sub)
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    return sub;
  }

  async findActiveByEvent(eventType: string): Promise<WebhookSubscription[]> {
    return this.subscriptionRepo
      .createQueryBuilder("sub")
      .where("sub.status = :status", {
        status: WebhookSubscriptionStatus.ACTIVE,
      })
      .andWhere(`(sub.events LIKE '%:event%' OR sub.events LIKE '%*%')`, {
        event: eventType,
      })
      .getMany();
  }

  async findActiveForEvent(eventType: string): Promise<WebhookSubscription[]> {
    // Find all active subscriptions and filter in JS since TypeORM simple-array
    // doesn't support LIKE well. In production with many subscriptions, use a
    // join table instead.
    const allActive = await this.subscriptionRepo.find({
      where: { status: WebhookSubscriptionStatus.ACTIVE },
    });
    return allActive.filter(
      (sub) => sub.events.includes("*") || sub.events.includes(eventType),
    );
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateWebhookSubscriptionDto,
  ): Promise<WebhookSubscription> {
    const sub = await this.findOne(id, userId);
    Object.assign(sub, dto);
    const saved = await this.subscriptionRepo.save(sub);
    this.logger.log(`Webhook subscription updated: ${id}`);
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const sub = await this.findOne(id, userId);
    sub.status = WebhookSubscriptionStatus.DISABLED;
    await this.subscriptionRepo.save(sub);
    this.logger.log(`Webhook subscription disabled: ${id}`);
  }

  async rotateKey(
    id: string,
    userId: string,
  ): Promise<WebhookSubscription & { newSigningKey: string }> {
    const sub = await this.findOne(id, userId);
    const newKey = this.generateSigningKey();
    sub.signingKey = newKey;
    const saved = await this.subscriptionRepo.save(sub);
    this.logger.log(`Signing key rotated for subscription ${id}`);
    return { ...saved, newSigningKey: newKey };
  }

  async toggleStatus(
    id: string,
    userId: string,
    status: WebhookSubscriptionStatus,
  ): Promise<WebhookSubscription> {
    const sub = await this.findOne(id, userId);
    sub.status = status;
    const saved = await this.subscriptionRepo.save(sub);
    this.logger.log(`Subscription ${id} status changed to ${status}`);
    return saved;
  }

  private generateSigningKey(): string {
    return `whsec_${randomBytes(32).toString("hex")}`;
  }
}
