/**
 * Client-side WebSocket service for dashboard clients.
 * This provides the reconnection logic with exponential backoff as specified in the requirements.
 */

import { Injectable, Logger } from "@nestjs/common";
import io from "socket.io-client";
import {
  DashboardEvent,
  BufferedEvent,
} from "../interfaces/websocket.interfaces";

export interface ClientConfig {
  url: string;
  token: string;
  userId: string;
  autoReconnect?: boolean;
  maxReconnectDelay?: number; // Maximum 30 seconds as per requirement
  baseReconnectDelay?: number;
  heartbeatInterval?: number; // 30 seconds as per requirement
  staleThreshold?: number; // 5 minutes as per requirement
}

export interface ConnectionState {
  status: "disconnected" | "connecting" | "connected" | "reconnecting";
  attempts: number;
  lastConnected: Date | null;
  lastDisconnected: Date | null;
}

export interface EventHandler {
  (data: any): void;
}

@Injectable()
export class DashboardClientService {
  private readonly logger = new Logger(DashboardClientService.name);

  private socket: any = null;
  private config: ClientConfig;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();

  // Reconnection state
  private reconnectAttempts: number = 0;
  private currentReconnectDelay: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;

  // Buffer for events during disconnection
  private eventBuffer: BufferedEvent[] = [];
  private maxBufferSize: number = 1000;

  // Connection state
  private connectionState: ConnectionState = {
    status: "disconnected",
    attempts: 0,
    lastConnected: null,
    lastDisconnected: null,
  };

  // Configuration defaults
  private readonly defaultConfig = {
    autoReconnect: true,
    maxReconnectDelay: 30000, // 30 seconds max as per requirement
    baseReconnectDelay: 1000, // Start with 1 second
    heartbeatInterval: 30000, // 30 seconds as per requirement
    staleThreshold: 5 * 60 * 1000, // 5 minutes as per requirement
    backoffFactor: 2,
  };

  constructor(config: ClientConfig) {
    this.config = { ...this.defaultConfig, ...config } as ClientConfig;
    this.currentReconnectDelay = this.config.baseReconnectDelay || 1000;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) {
      this.logger.warn("Already connected");
      return;
    }

    this.connectionState.status = "connecting";

    try {
      this.socket = io(`${this.config.url}/dashboard`, {
        transports: ["websocket"],
        auth: {
          token: this.config.token,
        },
        query: {
          userId: this.config.userId,
        },
        reconnection: false, // We handle reconnection manually
        timeout: 10000,
        forceNew: true,
      });

      this.setupEventHandlers();
    } catch (error) {
      this.logger.error(`Failed to create socket: ${error.message}`);
      this.connectionState.status = "disconnected";
      this.handleConnectionFailure();
      throw error;
    }
  }

  /**
   * Set up socket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this.logger.log("WebSocket connected");
      this.connectionState.status = "connected";
      this.connectionState.lastConnected = new Date();
      this.reconnectAttempts = 0;
      this.currentReconnectDelay = this.config.baseReconnectDelay || 1000;
      this.isReconnecting = false;

      // Send buffered events to server for replay
      this.requestEventReplay();
    });

    this.socket.on("disconnect", (reason: string) => {
      this.logger.warn(`WebSocket disconnected: ${reason}`);
      this.connectionState.lastDisconnected = new Date();
      this.connectionState.status = "disconnected";

      // Only auto-reconnect if not intentionally disconnected
      if (reason !== "io client disconnect" && this.config.autoReconnect) {
        this.startReconnection();
      }
    });

    this.socket.on("connect_error", (error: Error) => {
      this.logger.error(`Connection error: ${error.message}`);
      this.connectionState.status = "disconnected";

      if (this.config.autoReconnect) {
        this.handleConnectionFailure();
      }
    });

    // Handle reconnection success with missed events
    this.socket.on(DashboardEvent.RECONNECTION_SUCCESS, (data: any) => {
      this.logger.log(
        `Reconnected, received ${data.missedEvents} missed events`,
      );

      // Process missed events
      if (data.events && Array.isArray(data.events)) {
        for (const evt of data.events) {
          this.emit(evt.event, evt.data);
        }
      }
    });

    // Handle stale connection notification
    this.socket.on(DashboardEvent.CONNECTION_STALE, (data: any) => {
      this.logger.warn(`Connection marked as stale: ${data.reason}`);
      this.emit(DashboardEvent.CONNECTION_STALE, data);
    });

    // Handle heartbeat from server
    this.socket.on(DashboardEvent.HEARTBEAT, (data: any) => {
      this.sendHeartbeat();
    });

    // Handle connection established confirmation
    this.socket.on(DashboardEvent.CONNECTION_ESTABLISHED, (data: any) => {
      this.logger.debug(`Connection confirmed: ${data.clientId}`);
    });

    // Handle subscription confirmed
    this.socket.on(DashboardEvent.SUBSCRIPTION_CONFIRMED, (data: any) => {
      this.logger.debug(
        `Subscription confirmed for portfolio: ${data.portfolioId}`,
      );
    });

    // Handle error
    this.socket.on(DashboardEvent.ERROR, (error: any) => {
      this.logger.error(`Server error: ${JSON.stringify(error)}`);
      this.emit(DashboardEvent.ERROR, error);
    });

    // Set up periodic heartbeat
    this.startHeartbeat();
  }

  /**
   * Start periodic heartbeat
   */
  private startHeartbeat(): void {
    setInterval(() => {
      if (this.socket?.connected) {
        this.sendHeartbeat();
      }
    }, this.config.heartbeatInterval || 30000);
  }

  /**
   * Send heartbeat to server
   */
  private sendHeartbeat(): void {
    if (this.socket?.connected) {
      this.socket.emit(DashboardEvent.PING, {
        timestamp: new Date().toISOString(),
        clientTime: Date.now(),
      });
    }
  }

  /**
   * Request event replay from server
   */
  private requestEventReplay(): void {
    if (this.socket?.connected && this.eventBuffer.length > 0) {
      // Request replay of events since last disconnection
      const lastDisconnected = this.connectionState.lastDisconnected;
      if (lastDisconnected) {
        this.socket.emit(DashboardEvent.REPLAY_EVENTS, {
          since: lastDisconnected.toISOString(),
        });
      }

      // Clear local buffer as server will handle replay
      this.eventBuffer = [];
    }
  }

  /**
   * Start reconnection with exponential backoff
   */
  private startReconnection(): void {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    this.connectionState.status = "reconnecting";
    this.scheduleReconnect();
  }

  /**
   * Schedule next reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return;

    this.reconnectAttempts++;
    this.connectionState.attempts = this.reconnectAttempts;

    // Calculate delay with exponential backoff and jitter
    const jitter = Math.random() * 0.3 * this.currentReconnectDelay;
    const delay = Math.min(
      this.currentReconnectDelay + jitter,
      this.config.maxReconnectDelay || 30000,
    );

    this.logger.log(
      `Reconnection attempt ${this.reconnectAttempts} in ${Math.round(delay)}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnect();
    }, delay);

    // Calculate next delay
    const factor = 2;
    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * factor,
      this.config.maxReconnectDelay || 30000,
    );
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (!this.socket || !this.config.token) {
      this.logger.error("Cannot reconnect: socket or token not available");
      return;
    }

    try {
      // Reconnect with existing token
      this.socket.auth = { token: this.config.token };
      this.socket.connect();
    } catch (error) {
      this.logger.error(`Reconnection attempt failed: ${error.message}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(): void {
    if (this.config.autoReconnect) {
      this.startReconnection();
    }
  }

  /**
   * Subscribe to portfolio updates
   */
  async subscribePortfolio(portfolioId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        // Buffer the subscription request
        this.bufferEvent(DashboardEvent.SUBSCRIBE_PORTFOLIO, { portfolioId });
        reject(new Error("Not connected"));
        return;
      }

      this.socket.emit(
        DashboardEvent.SUBSCRIBE_PORTFOLIO,
        { portfolioId },
        (response: any) => {
          if (response.error) {
            reject(new Error(response.error.message || response.error));
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * Unsubscribe from portfolio updates
   */
  async unsubscribePortfolio(portfolioId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error("Not connected"));
        return;
      }

      this.socket.emit(
        DashboardEvent.UNSUBSCRIBE_PORTFOLIO,
        { portfolioId },
        (response: any) => {
          if (response.error) {
            reject(new Error(response.error.message || response.error));
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * Buffer an event when disconnected
   */
  private bufferEvent(event: DashboardEvent, data: any): void {
    this.eventBuffer.push({
      event,
      data,
      timestamp: new Date(),
    });

    // Limit buffer size
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }

  /**
   * Register event handler
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
  }

  /**
   * Remove event handler
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit event to registered handlers
   */
  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          this.logger.error(`Handler error for ${event}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Get buffered event count
   */
  getBufferedEventCount(): number {
    return this.eventBuffer.length;
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.config.autoReconnect = false; // Prevent auto-reconnect

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectionState.status = "disconnected";
    this.eventBuffer = [];
    this.isReconnecting = false;
  }

  /**
   * Reconnect manually
   */
  async reconnect(): Promise<void> {
    this.disconnect();
    this.config.autoReconnect = true;
    await this.connect();
  }

  /**
   * Update authentication token
   */
  updateToken(token: string): void {
    this.config.token = token;
    if (this.socket) {
      this.socket.auth = { token };
    }
  }
}

/**
 * Factory function to create DashboardClientService
 */
export function createDashboardClient(
  config: ClientConfig,
): DashboardClientService {
  return new DashboardClientService(config);
}
