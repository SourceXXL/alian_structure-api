import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import io from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

export interface UpstreamConnection {
  id: string;
  serviceName: string;
  url: string;
  socket: any;
  connectedAt: Date;
  lastHeartbeat: Date;
  isConnected: boolean;
  metadata?: Record<string, any>;
}

export interface PoolConfig {
  maxConnections: number; // Max 100 connections per upstream (as per requirement)
  connectionTimeout: number; // Connection timeout in ms
  heartbeatInterval: number; // Heartbeat interval in ms
  staleThreshold: number; // Time in ms to consider connection stale
  reconnectDelay: number; // Base delay for reconnection
  maxReconnectDelay: number; // Maximum reconnection delay
  maxReconnectAttempts: number; // Maximum reconnection attempts
}

export interface PoolStats {
  poolName: string;
  totalConnections: number;
  activeConnections: number;
  pendingConnections: number;
  maxConnections: number;
  utilizationPercent: number;
  services: Map<string, number>; // serviceName -> connection count
}

@Injectable()
export class ConnectionPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPoolService.name);

  // Map of poolName -> UpstreamConnection[]
  private pools: Map<string, UpstreamConnection[]> = new Map();

  // Map of connectionId -> UpstreamConnection
  private connections: Map<string, UpstreamConnection> = new Map();

  // Pool configurations
  private poolConfigs: Map<string, PoolConfig> = new Map();

  // Default configuration
  private readonly defaultConfig: PoolConfig = {
    maxConnections: 100,
    connectionTimeout: 10000,
    heartbeatInterval: 30000,
    staleThreshold: 5 * 60 * 1000, // 5 minutes
    reconnectDelay: 1000,
    maxReconnectDelay: 30000,
    maxReconnectAttempts: 10,
  };

  /**
   * Initialize a connection pool for a service
   */
  async initializePool(
    poolName: string,
    config?: Partial<PoolConfig>,
  ): Promise<void> {
    const poolConfig = { ...this.defaultConfig, ...config };
    this.poolConfigs.set(poolName, poolConfig);
    this.pools.set(poolName, []);

    this.logger.log(
      `Initialized connection pool: ${poolName} (max: ${poolConfig.maxConnections})`,
    );
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(
    poolName: string,
    serviceUrl: string,
    options?: { metadata?: Record<string, any> },
  ): Promise<UpstreamConnection | null> {
    const pool = this.pools.get(poolName);
    const config = this.poolConfigs.get(poolName) || this.defaultConfig;

    if (!pool) {
      this.logger.error(`Pool ${poolName} not found`);
      return null;
    }

    // Check if we can acquire more connections
    if (pool.length >= config.maxConnections) {
      this.logger.warn(
        `Pool ${poolName} at max capacity (${config.maxConnections})`,
      );

      // Try to find a stale connection to reuse
      const staleConnection = this.findStaleConnection(poolName);
      if (staleConnection) {
        this.logger.warn(`Reusing stale connection ${staleConnection.id}`);
        await this.disconnect(staleConnection.id);
      } else {
        return null;
      }
    }

    // Check if we already have a connection to this URL
    const existingConnection = pool.find(
      (c) => c.url === serviceUrl && c.isConnected,
    );
    if (existingConnection) {
      return existingConnection;
    }

    // Create new connection
    const connection = await this.createConnection(
      poolName,
      serviceUrl,
      options,
    );
    return connection;
  }

  /**
   * Create a new upstream connection
   */
  private async createConnection(
    poolName: string,
    url: string,
    options?: { metadata?: Record<string, any> },
  ): Promise<UpstreamConnection | null> {
    const config = this.poolConfigs.get(poolName) || this.defaultConfig;
    const pool = this.pools.get(poolName);

    const connectionId = uuidv4();

    return new Promise((resolve) => {
      const socket = io(url, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: config.maxReconnectAttempts,
        reconnectionDelay: config.reconnectDelay,
        reconnectionDelayMax: config.maxReconnectDelay,
        timeout: config.connectionTimeout,
        auth: {
          serviceId: connectionId,
          poolName,
        },
      });

      const connection: UpstreamConnection = {
        id: connectionId,
        serviceName: poolName,
        url,
        socket,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        isConnected: false,
        metadata: options?.metadata,
      };

      // Set up connection handlers
      socket.on("connect", () => {
        connection.isConnected = true;
        connection.lastHeartbeat = new Date();

        // Join pool
        pool.push(connection);
        this.connections.set(connectionId, connection);

        this.logger.log(
          `Upstream connection established: ${connectionId} (${url})`,
        );

        // Start heartbeat monitoring for this connection
        this.startHeartbeatMonitoring(connection);
      });

      socket.on("disconnect", (reason) => {
        connection.isConnected = false;
        this.logger.warn(
          `Upstream connection disconnected: ${connectionId} (${reason})`,
        );
      });

      socket.on("connect_error", (error) => {
        this.logger.error(
          `Upstream connection error: ${connectionId} - ${error.message}`,
        );
      });

      socket.on("pong", () => {
        connection.lastHeartbeat = new Date();
      });

      // Handle pong from server (upstream service)
      socket.on("heartbeat_ack", () => {
        connection.lastHeartbeat = new Date();
      });

      // Resolve after a short timeout
      setTimeout(() => {
        if (!connection.isConnected && !socket.connected) {
          socket.disconnect();
          resolve(null);
        }
      }, config.connectionTimeout);

      resolve(connection);
    });
  }

  /**
   * Release a connection back to the pool
   */
  async release(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastHeartbeat = new Date(); // Update heartbeat on release
    }
  }

  /**
   * Disconnect and remove a connection
   */
  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Remove from pool
    const pool = this.pools.get(connection.serviceName);
    if (pool) {
      const index = pool.findIndex((c) => c.id === connectionId);
      if (index !== -1) {
        pool.splice(index, 1);
      }
    }

    // Disconnect socket
    if (connection.socket.connected) {
      connection.socket.disconnect();
    }

    // Remove from connections map
    this.connections.delete(connectionId);

    this.logger.log(`Disconnected upstream connection: ${connectionId}`);
  }

  /**
   * Send a message through a connection
   */
  async send(connectionId: string, event: string, data: any): Promise<boolean> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.isConnected) {
      return false;
    }

    try {
      connection.socket.emit(event, data);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send message on connection ${connectionId}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats(poolName: string): PoolStats | null {
    const pool = this.pools.get(poolName);
    const config = this.poolConfigs.get(poolName);

    if (!pool || !config) return null;

    const activeConnections = pool.filter((c) => c.isConnected).length;
    const pendingConnections = pool.filter((c) => !c.isConnected).length;

    // Count connections by service name
    const services = new Map<string, number>();
    for (const connection of pool) {
      services.set(
        connection.serviceName,
        (services.get(connection.serviceName) || 0) + 1,
      );
    }

    return {
      poolName,
      totalConnections: pool.length,
      activeConnections,
      pendingConnections,
      maxConnections: config.maxConnections,
      utilizationPercent: (pool.length / config.maxConnections) * 100,
      services,
    };
  }

  /**
   * Get all pool statistics
   */
  getAllStats(): PoolStats[] {
    const stats: PoolStats[] = [];

    for (const poolName of this.pools.keys()) {
      const poolStats = this.getPoolStats(poolName);
      if (poolStats) {
        stats.push(poolStats);
      }
    }

    return stats;
  }

  /**
   * Find a stale connection in a pool
   */
  private findStaleConnection(poolName: string): UpstreamConnection | null {
    const pool = this.pools.get(poolName);
    if (!pool) return null;

    const config = this.poolConfigs.get(poolName) || this.defaultConfig;
    const now = Date.now();

    for (const connection of pool) {
      const timeSinceHeartbeat = now - connection.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > config.staleThreshold) {
        return connection;
      }
    }

    return null;
  }

  /**
   * Start heartbeat monitoring for a connection
   */
  private startHeartbeatMonitoring(connection: UpstreamConnection): void {
    const config =
      this.poolConfigs.get(connection.serviceName) || this.defaultConfig;

    const interval = setInterval(() => {
      if (!connection.isConnected) {
        clearInterval(interval);
        return;
      }

      try {
        connection.socket.emit("ping", { timestamp: Date.now() });
        connection.lastHeartbeat = new Date(); // Optimistic update
      } catch (error) {
        this.logger.error(
          `Heartbeat failed for connection ${connection.id}: ${error.message}`,
        );
      }
    }, config.heartbeatInterval);
  }

  /**
   * Get a connection by ID
   */
  getConnection(connectionId: string): UpstreamConnection | null {
    return this.connections.get(connectionId) || null;
  }

  /**
   * Check if a connection is healthy
   */
  isHealthy(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    const config =
      this.poolConfigs.get(connection.serviceName) || this.defaultConfig;
    const timeSinceHeartbeat = Date.now() - connection.lastHeartbeat.getTime();

    return connection.isConnected && timeSinceHeartbeat < config.staleThreshold;
  }

  /**
   * Clean up stale connections in all pools
   */
  cleanupStaleConnections(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [poolName, pool] of this.pools.entries()) {
      const config = this.poolConfigs.get(poolName) || this.defaultConfig;

      for (const connection of [...pool]) {
        const timeSinceHeartbeat = now - connection.lastHeartbeat.getTime();
        if (timeSinceHeartbeat > config.staleThreshold) {
          this.disconnect(connection.id);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} stale upstream connections`);
    }

    return cleaned;
  }

  async onModuleDestroy() {
    // Clean up all connections on shutdown
    for (const connectionId of this.connections.keys()) {
      await this.disconnect(connectionId);
    }

    this.pools.clear();
    this.connections.clear();
    this.poolConfigs.clear();

    this.logger.log("Connection pool service shut down");
  }
}
