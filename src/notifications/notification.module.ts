import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';

// Entities
import { Notification } from './entities/notification.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationAggregation } from './entities/notification-aggregation.entity';
import { NotificationDeliveryLog } from './entities/notification-delivery-log.entity';
import { NotificationAnalytics } from './entities/notification-analytics.entity';

// Services
import { NotificationService } from './services/notification.service';
import { NotificationQueueService } from './services/notification-queue.service';
import { NotificationProcessor } from './services/notification-processor.service';
import { NotificationTemplateService } from './services/notification-template.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { NotificationAggregationService } from './services/notification-aggregation.service';
import { NotificationAnalyticsService } from './services/notification-analytics.service';

// Providers (Channel strategies)
import { EmailNotificationProvider } from './providers/email-notification.provider';
import { SmsNotificationProvider } from './providers/sms-notification.provider';
import { PushNotificationProvider } from './providers/push-notification.provider';
import { WebhookNotificationProvider } from './providers/webhook-notification.provider';

// Gateway & Controller
import { NotificationGateway } from './websocket/notification.gateway';
import { NotificationController } from './notification.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      Notification,
      NotificationTemplate,
      NotificationPreference,
      NotificationAggregation,
      NotificationDeliveryLog,
      NotificationAnalytics,
    ]),
    BullModule.registerQueueAsync({
      name: 'notifications',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'change-me-in-production'),
        signOptions: { expiresIn: '24h' },
      }),
    }),
  ],
  controllers: [NotificationController],
  providers: [
    // Core services
    NotificationService,
    NotificationQueueService,
    NotificationProcessor,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationAggregationService,
    NotificationAnalyticsService,

    // Channel providers (Strategy pattern)
    EmailNotificationProvider,
    SmsNotificationProvider,
    PushNotificationProvider,
    WebhookNotificationProvider,

    // WebSocket gateway
    NotificationGateway,
  ],
  exports: [
    NotificationService,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationAggregationService,
    NotificationAnalyticsService,
    NotificationQueueService,
    NotificationGateway,
  ],
})
export class NotificationModule {}
