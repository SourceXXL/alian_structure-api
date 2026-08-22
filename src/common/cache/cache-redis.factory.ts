import Redis from "ioredis";
import { logger } from "../../config/logger";

/**
 * Create an ioredis client with sensible defaults for caching.
 *
 * Features:
 * - Lazy connection (caller must call `client.connect()` or let ioredis auto)
 * - Automatic reconnection with exponential backoff
 * - Configurable connection timeout
 * - Graceful error logging
 *
 * @param redisUrl  Full Redis URL (e.g. "redis://localhost:6379")
 * @param label     Human-readable label for log messages
 * @returns A connected ioredis instance
 */
export function createRedisClient(
  redisUrl: string,
  label = "cache",
): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 10) {
        logger.warn(
          { times, label },
          "Redis reconnection giving up after 10 attempts",
        );
        return null; // stop retrying
      }
      const delay = Math.min(times * 200, 5000);
      logger.debug(
        { times, delay, label },
        "Redis reconnecting after delay",
      );
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = [
        "READONLY",
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
      ];
      const shouldReconnect = targetErrors.some((e) =>
        err.message.includes(e),
      );
      if (shouldReconnect) {
        logger.warn(
          { error: err.message, label },
          "Redis reconnecting on recoverable error",
        );
      }
      return shouldReconnect;
    },
    connectTimeout: 10_000,
    enableReadyCheck: true,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
    keepAlive: 30_000,
    enableOfflineQueue: true,
  });

  client.on("connect", () => {
    logger.info({ label }, "Redis client connected");
  });

  client.on("ready", () => {
    logger.info({ label }, "Redis client ready");
  });

  client.on("error", (err: Error) => {
    logger.error({ error: err.message, label }, "Redis client error");
  });

  client.on("close", () => {
    logger.warn({ label }, "Redis client connection closed");
  });

  client.on("reconnecting", (delay: number) => {
    logger.info({ delay, label }, "Redis client reconnecting");
  });

  return client;
}
