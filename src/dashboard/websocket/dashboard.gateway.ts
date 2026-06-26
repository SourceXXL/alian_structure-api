import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsException,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger, UseFilters, UsePipes, ValidationPipe } from "@nestjs/common";
import { SpanStatusCode } from "@opentelemetry/api";
import { createSpan, extractContext } from "../../config/tracing";
import { JwtService } from "@nestjs/jwt";
import { ConnectionManagerService } from "./services/connection-manager.service";
import { EventBufferService } from "./services/event-buffer.service";
import { DashboardMetricsService } from "./services/dashboard-metrics.service";
import { WsExceptionFilter } from "./filters/ws-exception.filter";
import {
  DashboardEvent,
  ClientMessage,
  DashboardPayload,
  HeartbeatMessage,
  ReconnectionPayload,
} from "./interfaces/websocket.interfaces";

@WebSocketGateway({
  namespace: "/dashboard",
  cors: {
    origin: "*",
    credentials: true,
  },
  pingInterval: 30000, // 30 second heartbeat interval
  pingTimeout: 5000, // 5 second timeout for pong response
})
@UseFilters(WsExceptionFilter)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DashboardGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DashboardGateway.name);

  constructor(
    private readonly connectionManager: ConnectionManagerService,
    private readonly eventBuffer: EventBufferService,
    private readonly metricsService: DashboardMetricsService,
    private readonly jwtService: JwtService,
  ) {}

  async afterInit(server: Server) {
    this.logger.log("Dashboard WebSocket Gateway initialized");

    // Initialize connection health monitoring
    this.startHealthMonitoring();

    // Initialize stale connection cleanup
    this.startStaleConnectionCleanup();
  }

  async handleConnection(client: Socket) {
    // Extract trace context from handshake headers for distributed tracing
    const carrier = client.handshake.headers as Record<string, string>;
    await createSpan(`ws.connect ${client.id}`, async (span) => {
      span.setAttribute("ws.client_id", client.id);
      span.setAttribute("ws.namespace", "/dashboard");
      const traceParent = carrier["traceparent"];
      if (traceParent) span.setAttribute("ws.traceparent", traceParent);
    }).catch(() => {
      /* non-fatal */
    });

    try {
      // Authenticate the client
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(
          `Connection rejected: No token provided for client ${client.id}`,
        );
        client.emit("error", {
          code: "AUTH_REQUIRED",
          message: "Authentication token required",
        });
        client.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.sub || payload.userId;

      if (!userId) {
        throw new Error("Invalid token: missing user ID");
      }

      // Register connection in connection manager (with empty subscriptions array)
      await this.connectionManager.registerConnection(client.id, {
        userId,
        clientId: client.id,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        isAlive: true,
        subscriptions: [], // Initialize with empty subscriptions
      });

      // Join user room for broadcasting
      client.join(`user:${userId}`);

      // Update metrics
      this.metricsService.incrementConnection("dashboard", "connect");
      this.metricsService.setActiveConnections(
        "dashboard",
        await this.getConnectionCount(),
      );

      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);

      // Send buffered events for this user (missed during disconnection)
      const bufferedEvents = this.eventBuffer.getBufferedEvents(
        userId as string,
      );
      if (bufferedEvents.length > 0) {
        client.emit(DashboardEvent.RECONNECTION_SUCCESS, {
          missedEvents: bufferedEvents.length,
          events: bufferedEvents,
        } as ReconnectionPayload);

        this.logger.log(
          `Sent ${bufferedEvents.length} buffered events to client ${client.id}`,
        );
      }

      // Notify client of successful connection
      client.emit(DashboardEvent.CONNECTION_ESTABLISHED, {
        clientId: client.id,
        timestamp: new Date().toISOString(),
        heartbeatInterval: 30000,
      });
    } catch (error) {
      this.logger.error(
        `Connection error for client ${client.id}: ${error.message}`,
      );
      this.metricsService.incrementConnection("dashboard", "error");
      client.emit("error", {
        code: "AUTH_FAILED",
        message: "Authentication failed",
      });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    createSpan(`ws.disconnect ${client.id}`, async (span) => {
      span.setAttribute("ws.client_id", client.id);
      span.setAttribute("ws.namespace", "/dashboard");
      span.setStatus({ code: SpanStatusCode.OK });
    }).catch(() => {
      /* non-fatal */
    });

    const connectionInfo = this.connectionManager.getConnectionInfo(client.id);

    if (connectionInfo) {
      // Keep connection info for event buffering (up to 5 minutes)
      this.connectionManager.markDisconnected(client.id);

      // Start buffering events for this user
      this.eventBuffer.startBuffering(connectionInfo.userId, client.id);

      this.logger.log(
        `Client disconnected: ${client.id} (user: ${connectionInfo.userId})`,
      );

      // Update metrics
      this.metricsService.incrementConnection("dashboard", "disconnect");
      this.metricsService.setActiveConnections(
        "dashboard",
        await this.getConnectionCount(),
      );
    }
  }

  @SubscribeMessage(DashboardEvent.PING)
  async handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: HeartbeatMessage,
  ) {
    // Update heartbeat timestamp
    this.connectionManager.updateHeartbeat(client.id);

    this.metricsService.recordHeartbeat("dashboard");

    return {
      event: DashboardEvent.PONG,
      data: {
        timestamp: new Date().toISOString(),
        serverTime: Date.now(),
      },
    };
  }

  @SubscribeMessage(DashboardEvent.SUBSCRIBE_PORTFOLIO)
  async handleSubscribePortfolio(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ClientMessage<{ portfolioId: string }>,
  ) {
    const connectionInfo = this.connectionManager.getConnectionInfo(client.id);
    if (!connectionInfo) {
      throw new WsException("Connection not found");
    }

    const { portfolioId } = payload.data;

    // Join portfolio room
    client.join(`portfolio:${portfolioId}`);

    this.connectionManager.subscribeToPortfolio(client.id, portfolioId);

    this.logger.log(
      `Client ${client.id} subscribed to portfolio ${portfolioId}`,
    );

    return {
      event: DashboardEvent.SUBSCRIPTION_CONFIRMED,
      data: {
        portfolioId,
        subscribedAt: new Date().toISOString(),
      },
    };
  }

  @SubscribeMessage(DashboardEvent.UNSUBSCRIBE_PORTFOLIO)
  async handleUnsubscribePortfolio(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ClientMessage<{ portfolioId: string }>,
  ) {
    const { portfolioId } = payload.data;

    client.leave(`portfolio:${portfolioId}`);
    this.connectionManager.unsubscribeFromPortfolio(client.id, portfolioId);

    return {
      event: DashboardEvent.UNSUBSCRIPTION_CONFIRMED,
      data: { portfolioId },
    };
  }

  @SubscribeMessage(DashboardEvent.REPLAY_EVENTS)
  async handleReplayEvents(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ClientMessage<{ since: string }>,
  ) {
    const connectionInfo = this.connectionManager.getConnectionInfo(client.id);
    if (!connectionInfo) {
      throw new WsException("Connection not found");
    }

    const { since } = payload.data;
    const sinceDate = new Date(since);

    const replayedEvents = this.eventBuffer.getEventsSince(
      connectionInfo.userId,
      sinceDate,
    );

    return {
      event: DashboardEvent.EVENTS_REPLAYED,
      data: {
        count: replayedEvents.length,
        events: replayedEvents,
      },
    };
  }

  // Broadcast methods for server-side use
  broadcastToPortfolio(portfolioId: string, event: DashboardEvent, data: any) {
    this.server.to(`portfolio:${portfolioId}`).emit(event, data);
  }

  broadcastToUser(userId: string, event: DashboardEvent, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // Buffer event during disconnection
  bufferEvent(userId: string, event: DashboardEvent, data: any) {
    this.eventBuffer.bufferEvent(userId, {
      event,
      data,
      timestamp: new Date(),
    });
  }

  private extractToken(client: Socket): string | null {
    // Try authorization header first
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Try auth query parameter
    const tokenQuery = client.handshake.auth?.token;
    if (tokenQuery) {
      return tokenQuery;
    }

    // Try query parameter
    const tokenQueryParam = client.handshake.query?.token;
    if (typeof tokenQueryParam === "string") {
      return tokenQueryParam;
    }

    return null;
  }

  private async getConnectionCount(): Promise<number> {
    return this.connectionManager.getConnectionCount();
  }

  private startHealthMonitoring() {
    // Send heartbeat check every 30 seconds
    setInterval(() => {
      this.server.emit(DashboardEvent.HEARTBEAT, {
        timestamp: new Date().toISOString(),
      });
    }, 30000);
  }

  private startStaleConnectionCleanup() {
    // Check for stale connections every 60 seconds
    setInterval(async () => {
      const staleConnections = this.connectionManager.getStaleConnections(
        5 * 60 * 1000,
      ); // 5 minutes

      for (const [clientId, info] of staleConnections) {
        this.logger.warn(`Closing stale connection: ${clientId}`);

        // Emit stale notification to the client - the client will be disconnected by socket.io
        // when it doesn't respond to heartbeat
        this.server
          .to(`user:${info.userId}`)
          .emit(DashboardEvent.CONNECTION_STALE, {
            reason: "Connection timeout",
            disconnectedAt: new Date().toISOString(),
          });

        this.connectionManager.removeConnection(clientId);
        this.metricsService.incrementConnection("dashboard", "stale_cleanup");
      }

      // Clean up buffered events older than 5 minutes
      this.eventBuffer.cleanupOldEvents(5 * 60 * 1000);
    }, 60000);
  }
}
