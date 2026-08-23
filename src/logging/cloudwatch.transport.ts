/**
 * CloudWatch Transport factory.
 *
 * Adds a `winston-cloudwatch` transport to a Winston logger so that all
 * structured log records are shipped to AWS CloudWatch Logs.
 *
 * Required environment variables:
 *   - CLOUDWATCH_GROUP_NAME   — Log group name (e.g. "/alian-structure/api")
 *   - CLOUDWATCH_STREAM_NAME  — Log stream name (defaults to hostname + pid)
 *   - AWS_REGION              — AWS region (e.g. "us-east-1")
 *
 * Optional:
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  — explicit credentials;
 *     omit when running on ECS/Lambda with an IAM role attached.
 *   - CLOUDWATCH_UPLOAD_RATE_MS  — flush interval in ms (default 2000)
 *   - CLOUDWATCH_RETENTION_DAYS — log retention policy (default 30)
 */

import * as winston from "winston";
import * as os from "os";

export interface CloudWatchTransportOptions {
  /** CloudWatch log group name. Default: env CLOUDWATCH_GROUP_NAME */
  logGroupName?: string;
  /** CloudWatch log stream name. Default: `<hostname>-<pid>` */
  logStreamName?: string;
  /** AWS region. Default: env AWS_REGION */
  awsRegion?: string;
  /** AWS access key. Defaults to env AWS_ACCESS_KEY_ID. */
  awsAccessKeyId?: string;
  /** AWS secret access key. Defaults to env AWS_SECRET_ACCESS_KEY. */
  awsSecretAccessKey?: string;
  /** How often (ms) to flush buffered log entries. Default: 2000 */
  uploadRateMs?: number;
  /** Log retention in days. Default: 30 */
  retentionInDays?: number;
  /** Minimum log level to ship to CloudWatch. Default: "info" */
  level?: string;
}

/**
 * Creates a `winston-cloudwatch` transport and attaches it to the supplied
 * Winston logger.
 *
 * The function is a no-op when `logGroupName` cannot be resolved, so it is
 * safe to call unconditionally — the transport is only registered when the
 * required configuration is present.
 *
 * @returns The transport instance if created, or `null` when config is absent.
 */
export function createCloudWatchTransport(
  logger: winston.Logger,
  opts: CloudWatchTransportOptions = {},
): winston.transport | null {
  const {
    logGroupName = process.env.CLOUDWATCH_GROUP_NAME,
    logStreamName = process.env.CLOUDWATCH_STREAM_NAME ??
      `${os.hostname()}-${process.pid}`,
    awsRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
    awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY,
    uploadRateMs = parseInt(
      process.env.CLOUDWATCH_UPLOAD_RATE_MS ?? "2000",
      10,
    ),
    retentionInDays = parseInt(
      process.env.CLOUDWATCH_RETENTION_DAYS ?? "30",
      10,
    ),
    level = process.env.CLOUDWATCH_LOG_LEVEL ?? "info",
  } = opts;

  // Skip if required configuration is absent
  if (!logGroupName || !awsRegion) {
    return null;
  }

  try {
    // Lazy require — avoid loading the module (and its heavy AWS SDK peer) unless
    // the user has explicitly configured CloudWatch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WinstonCloudWatch = require("winston-cloudwatch");

    const cloudWatchConfig: Record<string, unknown> = {
      logGroupName,
      logStreamName,
      awsRegion,
      uploadRate: uploadRateMs,
      retentionInDays,
      level,
      // Format each log entry as a compact JSON string for CloudWatch Insights
      messageFormatter: ({
        level: lvl,
        message,
        ...meta
      }: Record<string, unknown>) =>
        JSON.stringify({ level: lvl, message, ...meta }),
      errorHandler: (err: Error) => {
        // Log transport errors to stderr to avoid infinite recursion
        process.stderr.write(`[CloudWatchTransport] Error: ${err.message}\n`);
      },
    };

    // Only set credentials if explicitly provided (allows IAM role pass-through)
    if (awsAccessKeyId && awsSecretAccessKey) {
      cloudWatchConfig.awsOptions = {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      };
    }

    const transport: winston.transport = new WinstonCloudWatch(
      cloudWatchConfig,
    );
    logger.add(transport);
    return transport;
  } catch (err) {
    process.stderr.write(
      `[CloudWatchTransport] Failed to initialise: ${(err as Error).message}\n`,
    );
    return null;
  }
}
