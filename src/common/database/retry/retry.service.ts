export enum RetryStrategy {
  FIXED_DELAY = "fixed",
  EXPONENTIAL_BACKOFF = "exponential",
  LINEAR_BACKOFF = "linear",
}

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  strategy: RetryStrategy;
  backoff?: {
    type?: string;
    factor?: number;
    delay?: number;
    maxDelay?: number;
  };
  shouldRetry?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
};

export function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const { backoff } = options;
  const resolvedStrategy = (backoff?.type as RetryStrategy) || opts.strategy;
  const resolvedBaseDelay = backoff?.delay ?? opts.baseDelay;
  const resolvedFactor = backoff?.factor ?? 2;
  const resolvedMaxDelay = backoff?.maxDelay ?? opts.maxDelay;

  return tryExecute(0);

  async function tryExecute(attemptIndex: number): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (attemptIndex >= opts.maxRetries) {
        throw error;
      }
      const shouldRetry =
        options.shouldRetry?.(error) ?? isTransientError(error);
      if (!shouldRetry) {
        throw error;
      }
      const delay = calculateDelay(
        resolvedStrategy,
        attemptIndex,
        resolvedBaseDelay,
        resolvedFactor,
        resolvedMaxDelay,
      );
      await sleep(delay);
      return tryExecute(attemptIndex + 1);
    }
  }
}

export function calculateDelay(
  strategy: RetryStrategy,
  attempt: number,
  baseDelay: number,
  factor: number,
  maxDelay: number,
): number {
  switch (strategy) {
    case RetryStrategy.EXPONENTIAL_BACKOFF:
      return Math.min(baseDelay * factor ** attempt, maxDelay);
    case RetryStrategy.LINEAR_BACKOFF:
      return Math.min(baseDelay * (attempt + 1), maxDelay);
    case RetryStrategy.FIXED_DELAY:
    default:
      return Math.min(baseDelay, maxDelay);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientError(error: any): boolean {
  if (!error) return false;
  const transientCodes = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNABORTED",
  ];
  const message = error.message ?? error.code ?? "";
  return transientCodes.some((code) => message.includes(code));
}

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class RetryService {
  async timeout(ms: number): Promise<void> {
    await sleep(ms);
    throw new Error("Timed out");
  }
}
