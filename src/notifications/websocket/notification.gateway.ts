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
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Notification } from '../entities/notification.entity';

/**
 * Real-time notification gateway.
 *
 * Clients connect to the `/notifications` namespace with a valid JWT token.
 * They automatically join a room named `user:<userId>` so the server can
 * push notifications to a specific user.
 *
 * Events:
 *   → Server → Client:
 *     `notification.new`         – a new notification arrived
 *     `notification.read`        – notification was marked read
 *     `notification.unread_count` – updated unread count
 *
 *   → Client → Server:
 *     `notification.mark_read`   – mark notification(s) as read
 *     `notification.mark_unread` – mark notification(s) as unread
 *     `notification.ping`        – heartbeat
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: '*', credentials: true },
  pingInterval: 30000,
  pingTimeout: 5000,
})
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  /** userId → Set<socketId> */
  private userConnections = new Map<string, Set<string>>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit(_server: Server) {
    this.logger.log('Notification WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.emit('error', { code: 'AUTH_REQUIRED', message: 'Authentication token required' });
        client.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.sub || payload.userId;
      if (!userId) {
        throw new Error('Invalid token: missing user ID');
      }

      // Store connection
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(client.id);

      // Join user room
      client.join(`user:${userId}`);
      (client as any).userId = userId;

      this.logger.log(`Client connected to notifications: ${client.id} (user: ${userId})`);

      // Send connection acknowledgment
      client.emit('connected', {
        clientId: client.id,
        timestamp: new Date().toISOString(),
        heartbeatInterval: 30000,
      });
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.emit('error', { code: 'AUTH_FAILED', message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      const connections = this.userConnections.get(userId);
      if (connections) {
        connections.delete(client.id);
        if (connections.size === 0) {
          this.userConnections.delete(userId);
        }
      }
      this.logger.log(`Client disconnected from notifications: ${client.id} (user: ${userId})`);
    }
  }

  @SubscribeMessage('notification.mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationIds: string[] },
  ) {
    const userId = (client as any).userId;
    if (!userId) throw new WsException('Not authenticated');

    // Emit read event back to the user's room
    this.server.to(`user:${userId}`).emit('notification.read', {
      notificationIds: data.notificationIds,
      timestamp: new Date().toISOString(),
    });

    return { event: 'ack', data: { processed: true } };
  }

  @SubscribeMessage('notification.mark_unread')
  async handleMarkUnread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationIds: string[] },
  ) {
    const userId = (client as any).userId;
    if (!userId) throw new WsException('Not authenticated');

    this.server.to(`user:${userId}`).emit('notification.unread', {
      notificationIds: data.notificationIds,
      timestamp: new Date().toISOString(),
    });

    return { event: 'ack', data: { processed: true } };
  }

  @SubscribeMessage('notification.ping')
  async handlePing(@ConnectedSocket() client: Socket) {
    return {
      event: 'notification.pong',
      data: { timestamp: new Date().toISOString(), serverTime: Date.now() },
    };
  }

  /**
   * Listen for new notifications from the NotificationService and push
   * them to the appropriate user's connected clients.
   */
  @OnEvent('notification.new')
  handleNewNotification(payload: { userId: string; notification: Notification }) {
    this.sendToUser(payload.userId, 'notification.new', {
      id: payload.notification.id,
      title: payload.notification.title,
      body: payload.notification.body,
      category: payload.notification.category,
      priority: payload.notification.priority,
      primaryChannel: payload.notification.primaryChannel,
      referenceId: payload.notification.referenceId,
      referenceType: payload.notification.referenceType,
      createdAt: payload.notification.createdAt,
    });
  }

  @OnEvent('notification.read')
  handleReadEvent(payload: { userId: string; notificationId: string }) {
    this.sendToUser(payload.userId, 'notification.read', {
      notificationId: payload.notificationId,
    });
  }

  @OnEvent('notification.unread_count')
  handleUnreadCountUpdate(payload: { userId: string; total: number; byCategory: Record<string, number> }) {
    this.sendToUser(payload.userId, 'notification.unread_count', payload);
  }

  /**
   * Send a message to all connected clients of a user.
   */
  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Broadcast to all connected clients.
   */
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }

  /**
   * Get the number of connected clients for a user.
   */
  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }

  /**
   * Get total connected client count.
   */
  getTotalConnectionCount(): number {
    let count = 0;
    for (const connections of this.userConnections.values()) {
      count += connections.size;
    }
    return count;
  }

  private extractToken(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    const tokenAuth = client.handshake.auth?.token;
    if (tokenAuth) return tokenAuth;
    const tokenQuery = client.handshake.query?.token;
    if (typeof tokenQuery === 'string') return tokenQuery;
    return null;
  }
}
