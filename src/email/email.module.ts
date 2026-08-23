import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bull";
import { EmailLog } from "./entities/email-log.entity";
import { EmailController } from "./email.controller";
import { EmailService } from "./email.service";
import { EmailQueueService } from "./services/email-queue.service";
import { EmailProcessor } from "./services/email-processor.service";
import { TemplateEngineService } from "./services/template-engine.service";
import { SmtpEmailProvider } from "./providers/smtp-email.provider";
import { SendgridEmailProvider } from "./providers/sendgrid-email.provider";
import { SesEmailProvider } from "./providers/ses-email.provider";

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([EmailLog]),
    BullModule.registerQueueAsync({
      name: "email",
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>("REDIS_HOST", "localhost"),
          port: configService.get<number>("REDIS_PORT", 6379),
          password: configService.get<string>("REDIS_PASSWORD"),
        },
        defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
      }),
    }),
  ],
  controllers: [EmailController],
  providers: [
    EmailService,
    EmailQueueService,
    EmailProcessor,
    TemplateEngineService,
    SmtpEmailProvider,
    SendgridEmailProvider,
    SesEmailProvider,
  ],
  exports: [EmailService, TemplateEngineService],
})
export class EmailModule {}
