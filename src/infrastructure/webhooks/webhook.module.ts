import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bull";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { WebhookSubscription } from "./entities/webhook-subscription.entity";
import { WebhookEvent } from "./entities/webhook-event.entity";
import { WebhookDelivery } from "./entities/webhook-delivery.entity";
import { WebhookDeadLetter } from "./entities/webhook-dead-letter.entity";

import { WebhookController } from "./webhook.controller";
import { WebhookSubscriptionService } from "./services/webhook-subscription.service";
import { WebhookEventService } from "./services/webhook-event.service";
import { WebhookDeliveryService } from "./services/webhook-delivery.service";
import { WebhookHmacService } from "./services/webhook-hmac.service";
import { WebhookProcessor } from "./services/webhook-processor.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WebhookSubscription,
      WebhookEvent,
      WebhookDelivery,
      WebhookDeadLetter,
    ]),
    BullModule.registerQueueAsync({
      name: "webhook-delivery",
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>("REDIS_HOST", "localhost"),
          port: configService.get<number>("REDIS_PORT", 6379),
          password: configService.get<string>("REDIS_PASSWORD"),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 200,
          attempts: 1, // We handle retries via delivery service backoff
        },
      }),
    }),
    HttpModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookSubscriptionService,
    WebhookEventService,
    WebhookDeliveryService,
    WebhookHmacService,
    WebhookProcessor,
  ],
  exports: [
    WebhookEventService,
    WebhookDeliveryService,
    WebhookSubscriptionService,
    WebhookHmacService,
  ],
})
export class WebhookModule {}
