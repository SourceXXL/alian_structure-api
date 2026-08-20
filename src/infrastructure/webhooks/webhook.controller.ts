import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { WebhookSubscriptionService } from "./services/webhook-subscription.service";
import { WebhookEventService } from "./services/webhook-event.service";
import { WebhookDeliveryService } from "./services/webhook-delivery.service";
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  PublishWebhookEventDto,
} from "./dto/webhook.dto";

@ApiTags("Webhooks")
@ApiBearerAuth()
@Controller("webhooks")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly subscriptionService: WebhookSubscriptionService,
    private readonly eventService: WebhookEventService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  // ── Subscriptions ───────────────────────────────────────────────────

  @Post("subscriptions")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a webhook subscription" })
  @ApiResponse({ status: 201, description: "Subscription created with signing key" })
  async createSubscription(
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    // TODO: extract userId from auth guard
    const userId = "system";
    const sub = await this.subscriptionService.create(userId, dto);
    return {
      success: true,
      subscription: sub,
      message: "Store the signingKey securely — it will not be shown again.",
    };
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List all webhook subscriptions" })
  async listSubscriptions() {
    const userId = "system";
    const subscriptions = await this.subscriptionService.findAll(userId);
    // Strip signing keys from response
    const safe = subscriptions.map(({ signingKey, ...rest }) => rest);
    return { success: true, subscriptions: safe };
  }

  @Get("subscriptions/:id")
  @ApiOperation({ summary: "Get a webhook subscription by ID" })
  @ApiParam({ name: "id" })
  async getSubscription(@Param("id") id: string) {
    const userId = "system";
    const sub = await this.subscriptionService.findOne(id, userId);
    const { signingKey, ...rest } = sub;
    return { success: true, subscription: rest };
  }

  @Put("subscriptions/:id")
  @ApiOperation({ summary: "Update a webhook subscription" })
  @ApiParam({ name: "id" })
  async updateSubscription(
    @Param("id") id: string,
    @Body() dto: UpdateWebhookSubscriptionDto,
  ) {
    const userId = "system";
    const sub = await this.subscriptionService.update(id, userId, dto);
    const { signingKey, ...rest } = sub;
    return { success: true, subscription: rest };
  }

  @Delete("subscriptions/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable a webhook subscription" })
  @ApiParam({ name: "id" })
  async deleteSubscription(@Param("id") id: string) {
    const userId = "system";
    await this.subscriptionService.remove(id, userId);
    return { success: true, message: "Subscription disabled" };
  }

  @Post("subscriptions/:id/rotate-key")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the signing key for a subscription" })
  @ApiParam({ name: "id" })
  async rotateKey(@Param("id") id: string) {
    const userId = "system";
    const result = await this.subscriptionService.rotateKey(id, userId);
    return {
      success: true,
      newSigningKey: result.newSigningKey,
      message: "Store the new signingKey securely — it will not be shown again.",
    };
  }

  @Put("subscriptions/:id/status")
  @ApiOperation({ summary: "Toggle subscription status (active/paused/disabled)" })
  @ApiParam({ name: "id" })
  @ApiQuery({ name: "status", enum: ["active", "paused", "disabled"] })
  async toggleStatus(
    @Param("id") id: string,
    @Query("status") status: "active" | "paused" | "disabled",
  ) {
    const userId = "system";
    const sub = await this.subscriptionService.toggleStatus(id, userId, status as any);
    const { signingKey, ...rest } = sub;
    return { success: true, subscription: rest };
  }

  // ── Events ──────────────────────────────────────────────────────────

  @Post("events")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Publish a webhook event" })
  @ApiResponse({ status: 201, description: "Event published and deliveries enqueued" })
  async publishEvent(@Body() dto: PublishWebhookEventDto) {
    const event = await this.eventService.publishEvent(dto);
    return {
      success: true,
      event,
      message: `Event enqueued for ${event.deliveryCount} subscribers`,
    };
  }

  @Get("events")
  @ApiOperation({ summary: "List recent webhook events" })
  @ApiQuery({ name: "type", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  async listEvents(
    @Query("type") type?: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    const events = await this.eventService.listEvents(
      type,
      limit || 50,
      offset || 0,
    );
    return { success: true, events };
  }

  @Get("events/:id")
  @ApiOperation({ summary: "Get event details with deliveries" })
  @ApiParam({ name: "id" })
  async getEvent(@Param("id") id: string) {
    const event = await this.eventService.getEvent(id);
    if (!event) return { success: false, message: "Event not found" };
    const deliveries = await this.deliveryService.getDeliveriesByEvent(id);
    return { success: true, event, deliveries };
  }

  @Post("events/:id/replay")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Replay an event to current subscribers" })
  @ApiParam({ name: "id" })
  async replayEvent(@Param("id") id: string) {
    const event = await this.eventService.replayEvent(id);
    if (!event) return { success: false, message: "Event not found" };
    return { success: true, event };
  }

  // ── Dead Letters ────────────────────────────────────────────────────

  @Get("dead-letters")
  @ApiOperation({ summary: "List dead-lettered deliveries" })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  async listDeadLetters(
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    const userId = "system";
    const deadLetters = await this.deliveryService.getDeadLetters(
      userId,
      limit || 50,
      offset || 0,
    );
    return { success: true, deadLetters };
  }

  @Post("dead-letters/:id/retry")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Retry a dead-lettered delivery" })
  @ApiParam({ name: "id" })
  async retryDeadLetter(@Param("id") id: string) {
    const delivery = await this.deliveryService.retryDeadLetter(id);
    if (!delivery) {
      return { success: false, message: "Dead letter not found or already retried" };
    }
    return { success: true, delivery };
  }

  // ── Metrics ─────────────────────────────────────────────────────────

  @Get("metrics")
  @ApiOperation({ summary: "Get webhook delivery metrics and reliability stats" })
  async getMetrics() {
    const metrics = await this.deliveryService.getMetrics();
    return { success: true, metrics };
  }
}
