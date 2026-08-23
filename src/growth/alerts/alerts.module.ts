import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Alert } from "./entities/alert.entity";
import { AlertTriggerLog } from "./entities/alert-trigger-log.entity";
import { AlertPreference } from "./entities/alert-preference.entity";
import { AlertsService } from "./alerts.service";
import { AlertsController } from "./alerts.controller";
import { AlertDispatcherService } from "./services/alert-dispatcher.service";
import { AlertEvaluationService } from "./services/alert-evaluation.service";
import { RiskAlertListener } from "./listeners/risk-alert.listener";
import { PortfolioAlertListener } from "./listeners/portfolio-alert.listener";
import { PushNotificationService } from "./services/push-notification.service";
import { EmailModule } from "../../email/email.module";
import { DashboardModule } from "../../dashboard/dashboard.module";

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TypeOrmModule.forFeature([Alert, AlertTriggerLog, AlertPreference]),
    forwardRef(() => EmailModule),
    forwardRef(() => DashboardModule),
  ],
  providers: [
    AlertsService,
    AlertDispatcherService,
    AlertEvaluationService,
    RiskAlertListener,
    PortfolioAlertListener,
    PushNotificationService,
  ],
  controllers: [AlertsController],
  exports: [
    AlertsService,
    AlertDispatcherService,
    AlertEvaluationService,
    PushNotificationService,
  ],
})
export class AlertsModule {}
