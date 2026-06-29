import { Injectable, Logger } from "@nestjs/common";
import { ReconnectionConfig } from "../interfaces/websocket.interfaces";

/**
 * Client-side reconnection service with exponential backoff.
 * This is designed for use in client applications connecting to the dashboard.
 */
@Injectable()
export class ReconnectionService {
  private readonly logger = new Logger(ReconnectionService.name);

  private readonly defaultConfig: ReconnectionConfig = {
    maxDelay: 30000, // Maximum 30 second delay as per requirement
    baseDelay: 1000, // Start with 1 second
    maxAttempts: Infinity, // Keep trying until successful
    factor: 2, // Double delay each time
  };

  private config: ReconnectionConfig;
  private currentDelay: number;
  private attempts: number = 0;
  private isReconnecting: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Callbacks
  private onReconnect: (() => void) | null = null;
  private onReconnectAttempt:
    | ((attempt: number, delay: number) => void)
    | null = null;
  private onReconnectFailed:
    | ((attempts: number, totalDelay: number) => void)
    | null = null;

  constructor(config?: Partial<ReconnectionConfig>) {
    this.config = { ...this.defaultConfig, ...config };
    this.currentDelay = this.config.baseDelay;
  }

  /**
   * Update configuration
   */
  configure(config: Partial<ReconnectionConfig>): void {
    this.config = { ...this.config, ...config };
    this.reset();
  }

  /**
   * Reset reconnection state
   */
  reset(): void {
    this.currentDelay = this.config.baseDelay;
    this.attempts = 0;
    this.isReconnecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start reconnection process
   */
  startReconnection(
    onReconnect: () => void,
    onAttempt?: (attempt: number, delay: number) => void,
    onFailed?: (attempts: number, totalDelay: number) => void,
  ): void {
    this.onReconnect = onReconnect;
    this.onReconnectAttempt = onAttempt || null;
    this.onReconnectFailed = onFailed || null;

    this.isReconnecting = true;
    this.scheduleReconnect();
  }

  /**
   * Stop reconnection process
   */
  stopReconnection(): void {
    this.isReconnecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.logger.debug("Reconnection process stopped");
  }

  /**
   * Notify successful reconnection
   */
  notifySuccess(): void {
    this.logger.log(`Reconnection successful after ${this.attempts} attempts`);
    this.reset();
    this.isReconnecting = false;
  }

  /**
   * Get current reconnection state
   */
  getState(): {
    isReconnecting: boolean;
    attempts: number;
    currentDelay: number;
    nextDelay: number;
  } {
    return {
      isReconnecting: this.isReconnecting,
      attempts: this.attempts,
      currentDelay: this.currentDelay,
      nextDelay: this.calculateNextDelay(),
    };
  }

  /**
   * Check if should attempt reconnection
   */
  shouldAttempt(): boolean {
    if (!this.isReconnecting) return false;
    if (this.config.maxAttempts === Infinity) return true;
    return this.attempts < this.config.maxAttempts;
  }

  /**
   * Calculate next delay with exponential backoff and jitter
   */
  private calculateNextDelay(): number {
    // Add some jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * this.currentDelay;
    return Math.min(this.currentDelay + jitter, this.config.maxDelay);
  }

  /**
   * Schedule next reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.shouldAttempt()) {
      const totalDelay = this.calculateTotalDelay();
      if (this.onReconnectFailed) {
        this.onReconnectFailed(this.attempts, totalDelay);
      }
      this.logger.warn(`Max reconnection attempts reached (${this.attempts})`);
      this.isReconnecting = false;
      return;
    }

    this.attempts++;
    const delay = this.calculateNextDelay();

    this.logger.debug(
      `Scheduling reconnection attempt ${this.attempts} in ${delay}ms`,
    );

    if (this.onReconnectAttempt) {
      this.onReconnectAttempt(this.attempts, delay);
    }

    this.reconnectTimer = setTimeout(() => {
      if (this.onReconnect) {
        this.onReconnect();
      }

      // After calling onReconnect, the caller should call notifySuccess or schedule next attempt
    }, delay);

    // Calculate next delay for next iteration
    this.currentDelay = Math.min(
      this.currentDelay * this.config.factor,
      this.config.maxDelay,
    );
  }

  /**
   * Calculate total accumulated delay
   */
  private calculateTotalDelay(): number {
    let total = 0;
    let delay = this.config.baseDelay;

    for (let i = 0; i < this.attempts; i++) {
      total += delay;
      delay = Math.min(delay * this.config.factor, this.config.maxDelay);
    }

    return total;
  }

  /**
   * Manually trigger next reconnection attempt
   */
  triggerAttempt(): void {
    if (this.shouldAttempt()) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      this.scheduleReconnect();
    }
  }
}

/**
 * WebSocket client manager that handles reconnection logic
 */
@Injectable()
export class WebSocketClientManager {
  private readonly logger = new Logger(WebSocketClientManager.name);

  private socket: any = null;
  private reconnectService: ReconnectionService;
  private eventBuffer: any[] = [];
  private messageHandlers: Map<string, Function[]> = new Map();
  private connectionState:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting" = "disconnected";
  private token: string | null = null;
  private userId: string | null = null;

  constructor(config?: Partial<ReconnectionConfig>) {
    this.reconnectService = new ReconnectionService(config);
  }

  /**
   * Connect to WebSocket server
   */
  async connect(url: string, token: string, userId: string): Promise<void> {
    this.token = token;
    this.userId = userId;
    this.connectionState = "connecting";

    try {
      // Dynamic import for socket.io-client
      const socketIo = await import("socket.io-client");

      this.socket = socketIo.default(url, {
        transports: ["websocket"],
        auth: { token },
        query: { userId },
        reconnection: false, // We handle reconnection manually
        timeout: 10000,
      });

      this.setupEventHandlers();
    } catch (error) {
      this.logger.error(`Failed to create socket: ${error.message}`);
      this.handleConnectionFailure();
    }
  }

  /**
   * Set up socket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this.logger.log("WebSocket connected");
      this.connectionState = "connected";
      this.reconnectService.notifySuccess();

      // Flush buffered events
      this.flushBufferedEvents();

      // Re-subscribe to channels
      this.resubscribe();
    });

    this.socket.on("disconnect", (reason: string) => {
      this.logger.warn(`WebSocket disconnected: ${reason}`);
      this.connectionState = "disconnected";

      // Only auto-reconnect if not intentionally disconnected
      if (reason !== "io client disconnect") {
        this.startReconnection();
      }
    });

    this.socket.on("connect_error", (error: Error) => {
      this.logger.error(`Connection error: ${error.message}`);
      this.handleConnectionFailure();
    });

    this.socket.on("error", (error: any) => {
      this.logger.error(`Socket error: ${JSON.stringify(error)}`);
    });

    // Listen for all dashboard events
    this.setupDashboardEventHandlers();
  }

  /**
   * Set up dashboard-specific event handlers
   */
  private setupDashboardEventHandlers(): void {
    if (!this.socket) return;

    // Listen for various events
    const events = [
      "portfolio:update",
      "portfolio:performance:update",
      "portfolio:allocation:update",
      "portfolio:risk:update",
      "portfolio:holdings:update",
      "connection:stale",
      "reconnection:success",
      "heartbeat",
    ];

    for (const event of events) {
      this.socket.on(event, (data: any) => {
        // Notify registered handlers
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(data);
            } catch (error) {
              this.logger.error(`Handler error for ${event}: ${error.message}`);
            }
          }
        }
      });
    }

    // Handle reconnection success with buffered events
    this.socket.on("reconnection:success", (data: any) => {
      this.logger.log(
        `Reconnection successful, received ${data.missedEvents} missed events`,
      );

      if (data.events && Array.isArray(data.events)) {
        for (const evt of data.events) {
          const handlers = this.messageHandlers.get(evt.event);
          if (handlers) {
            for (const handler of handlers) {
              handler(evt.data);
            }
          }
        }
      }
    });
  }

  /**
   * Start reconnection process with exponential backoff
   */
  private startReconnection(): void {
    this.connectionState = "reconnecting";

    this.reconnectService.startReconnection(
      () => this.attemptReconnect(),
      (attempt, delay) => {
        this.logger.log(`Reconnection attempt ${attempt} in ${delay}ms`);
      },
      (attempts, totalDelay) => {
        this.logger.error(
          `Failed to reconnect after ${attempts} attempts (total delay: ${totalDelay}ms)`,
        );
        this.connectionState = "disconnected";
      },
    );
  }

  /**
   * Attempt to reconnect
   */
  private async attemptReconnect(): Promise<void> {
    if (!this.socket || !this.token) {
      this.logger.error("Cannot reconnect: socket or token not available");
      return;
    }

    try {
      // Reconnect with existing token
      this.socket.auth = { token: this.token };
      this.socket.connect();
    } catch (error) {
      this.logger.error(`Reconnection attempt failed: ${error.message}`);
    }
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(): void {
    this.connectionState = "disconnected";
    this.startReconnection();
  }

  /**
   * Buffer an event when disconnected
   */
  private bufferEvent(event: string, data: any): void {
    this.eventBuffer.push({ event, data, timestamp: new Date() });

    // Limit buffer size
    if (this.eventBuffer.length > 1000) {
      this.eventBuffer.shift();
    }
  }

  /**
   * Flush buffered events when reconnected
   */
  private async flushBufferedEvents(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    this.logger.log(`Flushing ${this.eventBuffer.length} buffered events`);

    // Events will be replayed by the server on reconnection
    // so we just clear our local buffer
    this.eventBuffer = [];
  }

  /**
   * Resubscribe to channels after reconnection
   */
  private resubscribe(): void {
    // Re-subscription is handled automatically by the server
    // based on the user's connection history
  }

  /**
   * Subscribe to a portfolio
   */
  async subscribePortfolio(portfolioId: string): Promise<void> {
    if (this.connectionState === "disconnected") {
      this.bufferEvent("portfolio:subscribe", { portfolioId });
      return;
    }

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Socket not connected"));
        return;
      }

      this.socket.emit(
        "portfolio:subscribe",
        { portfolioId },
        (response: any) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * Register event handler
   */
  on(event: string, handler: Function): void {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, []);
    }
    this.messageHandlers.get(event).push(handler);
  }

  /**
   * Remove event handler
   */
  off(event: string, handler: Function): void {
    const handlers = this.messageHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Get connection state
   */
  getConnectionState(): string {
    return this.connectionState;
  }

  /**
   * Get reconnection state
   */
  getReconnectionState() {
    return this.reconnectService.getState();
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.reconnectService.stopReconnection();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectionState = "disconnected";
    this.eventBuffer = [];
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Send raw event
   */
  send(event: string, data: any): Promise<any> {
    if (this.connectionState === "disconnected") {
      this.bufferEvent(event, data);
      return Promise.reject(new Error("Not connected"));
    }

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Socket not connected"));
        return;
      }

      this.socket.emit(event, data, (response: any) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }
}
