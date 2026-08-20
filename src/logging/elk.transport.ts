/**
 * ELK (Elasticsearch + Logstash + Kibana) Transport.
 *
 * Ships log records to Elasticsearch using the official `@elastic/elasticsearch`
 * client. Each log line is indexed as a document in a daily index following
 * the pattern `<indexPrefix>-YYYY.MM.DD`.
 *
 * Required environment variables:
 *   - ELASTICSEARCH_URL   — Node URL (e.g. "http://localhost:9200")
 *
 * Optional:
 *   - ELASTICSEARCH_INDEX_PREFIX  — default "logs-alian-structure"
 *   - ELASTICSEARCH_USERNAME      — HTTP basic auth username
 *   - ELASTICSEARCH_PASSWORD      — HTTP basic auth password
 *   - ELASTICSEARCH_API_KEY       — API key (base64 id:api_key)
 *   - ELASTICSEARCH_CA_CERT       — Path to CA certificate file (for TLS)
 *   - ELASTICSEARCH_LOG_LEVEL     — Minimum level to ship (default "info")
 */

import Transport from "winston-transport";
import { LEVEL, MESSAGE } from "triple-beam";

export interface ElkTransportOptions {
  /** Elasticsearch node URL. Default: env ELASTICSEARCH_URL */
  node?: string;
  /** Index name prefix. Default: "logs-alian-structure" */
  indexPrefix?: string;
  /** HTTP basic auth username */
  username?: string;
  /** HTTP basic auth password */
  password?: string;
  /** Elasticsearch API key (base64 encoded `id:api_key`) */
  apiKey?: string;
  /** Path to a CA certificate for self-signed TLS */
  caCertPath?: string;
  /** Minimum log level to forward to ELK. Default: "info" */
  level?: string;
  /** Service name included in every document. */
  serviceName?: string;
}

interface LogInfo {
  level: string;
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Winston transport that indexes log records into Elasticsearch.
 */
export class ElkTransport extends Transport {
  private readonly _indexPrefix: string;
  private readonly _serviceName: string;
  private _client: any | null = null; // typed as any to avoid hard es dependency

  constructor(private readonly opts: ElkTransportOptions = {}) {
    super({
      level: opts.level ?? process.env.ELASTICSEARCH_LOG_LEVEL ?? "info",
    });

    this._indexPrefix =
      opts.indexPrefix ??
      process.env.ELASTICSEARCH_INDEX_PREFIX ??
      "logs-alian-structure";

    this._serviceName =
      opts.serviceName ?? process.env.SERVICE_NAME ?? "alian-structure-api";

    const node = opts.node ?? process.env.ELASTICSEARCH_URL;
    if (node) {
      this._initClient(node);
    }
  }

  private _initClient(node: string): void {
    try {
      // Lazy require — keeps the module loadable even when @elastic/elasticsearch
      // is not installed or ELASTICSEARCH_URL is absent.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client } = require("@elastic/elasticsearch");

      const clientOpts: Record<string, unknown> = { node };

      const {
        username = process.env.ELASTICSEARCH_USERNAME,
        password = process.env.ELASTICSEARCH_PASSWORD,
        apiKey = process.env.ELASTICSEARCH_API_KEY,
        caCertPath = process.env.ELASTICSEARCH_CA_CERT,
      } = this.opts;

      if (apiKey) {
        clientOpts.auth = { apiKey };
      } else if (username && password) {
        clientOpts.auth = { username, password };
      }

      if (caCertPath) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require("fs");
        clientOpts.tls = { ca: fs.readFileSync(caCertPath) };
      }

      this._client = new Client(clientOpts);
    } catch (err) {
      process.stderr.write(
        `[ElkTransport] Failed to initialise Elasticsearch client: ${(err as Error).message}\n`,
      );
    }
  }

  /** Called by Winston for each log record. */
  log(info: LogInfo, callback: () => void): void {
    setImmediate(() => this.emit("logged", info));

    if (!this._client) {
      callback();
      return;
    }

    const index = this._buildIndexName();
    const body = {
      "@timestamp": info.timestamp ?? new Date().toISOString(),
      log: {
        level: info[LEVEL as unknown as string] ?? info.level,
      },
      message: info.message,
      service: { name: this._serviceName },
      ...this._flattenMeta(info),
    };

    this._client.index({ index, body }).catch((err: Error) => {
      process.stderr.write(
        `[ElkTransport] Failed to index log record: ${err.message}\n`,
      );
    });

    callback();
  }

  /** Builds the current daily index name: `<prefix>-YYYY.MM.DD`. */
  private _buildIndexName(): string {
    const now = new Date();
    const datePart = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    ].join(".");
    return `${this._indexPrefix}-${datePart}`;
  }

  /** Strips Winston internal symbols before indexing. */
  private _flattenMeta(info: LogInfo): Record<string, unknown> {
    const { level, message, timestamp, ...rest } = info;
    // Remove winston internal symbols
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (typeof key === "string") {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  /** Gracefully close the Elasticsearch client connection. */
  async close(): Promise<void> {
    if (this._client) {
      await this._client.close();
    }
  }
}

/**
 * Convenience factory — attaches an {@link ElkTransport} to a Winston logger
 * when `ELASTICSEARCH_URL` is configured.
 *
 * @returns The transport instance if created, or `null` when config is absent.
 */
export function createElkTransport(
  logger: import("winston").Logger,
  opts: ElkTransportOptions = {},
): ElkTransport | null {
  const node = opts.node ?? process.env.ELASTICSEARCH_URL;
  if (!node) return null;

  const transport = new ElkTransport({ ...opts, node });
  logger.add(transport);
  return transport;
}
