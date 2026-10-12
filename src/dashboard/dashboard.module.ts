import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { PortfolioModule } from "src/investment/portfolio/portfolio.module";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";

// WebSocket Gateway and related modules
import { DashboardGateway } from "./websocket/dashboard.gateway";
import { ConnectionManagerService } from "./websocket/services/connection-manager.service";
import { EventBufferService } from "./websocket/services/event-buffer.service";
import { ConnectionPoolService } from "./websocket/services/connection-pool.service";
import { DashboardMetricsService } from "./websocket/services/dashboard-metrics.service";
import {
  ReconnectionService,
  WebSocketClientManager,
} from "./websocket/services/reconnection.service";
import { WebSocketHealthService } from "./websocket/services/websocket-health.service";
import { WsExceptionFilter } from "./websocket/filters/ws-exception.filter";
import { buildJwtModuleOptions, LONG_LIVED_TOKEN_TTL } from "src/config/jwt.config";

@Module({
  imports: [
    PortfolioModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildJwtModuleOptions({
          secret:
            configService.get<string>("JWT_SECRET") ||
            "default-secret-change-in-production",
          // The websocket gateway issues its own long-lived ticket, separate
          // from the 15m access-token issuer in AuthModule. Unchanged.
          expiresIn: LONG_LIVED_TOKEN_TTL,
        }),
    }),
  ],
  controllers: [DashboardController],
  providers: [
    DashboardService,

    // WebSocket Gateway
    DashboardGateway,

    // WebSocket Services
    ConnectionManagerService,
    EventBufferService,
    ConnectionPoolService,
    DashboardMetricsService,
    ReconnectionService,
    WebSocketClientManager,
    WebSocketHealthService,

    // Filters
    WsExceptionFilter,
  ],
  exports: [
    DashboardGateway,
    ConnectionManagerService,
    EventBufferService,
    ConnectionPoolService,
    WebSocketHealthService,
  ],
})
export class DashboardModule {}
