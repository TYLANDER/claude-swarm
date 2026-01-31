/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 (default: 0.3 = ±30%) */
  jitter?: number;
  /** Whether to retry on specific errors only */
  retryableErrors?: (error: unknown) => boolean;
  /** Callback for each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_CONFIG: Required<Omit<RetryConfig, "retryableErrors" | "onRetry">> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: 0.3,
};

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number,
): number {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: random value in range [1-jitter, 1+jitter]
  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * jitter;

  return Math.round(cappedDelay * jitterMultiplier);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetchData(),
 *   {
 *     maxRetries: 3,
 *     onRetry: (attempt, error) => console.log(`Retry ${attempt}:`, error),
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_CONFIG.maxRetries,
    baseDelayMs = DEFAULT_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_CONFIG.maxDelayMs,
    jitter = DEFAULT_CONFIG.jitter,
    retryableErrors,
    onRetry,
  } = config;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if this error should be retried
      if (retryableErrors && !retryableErrors(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        throw error;
      }

      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);

      // Notify callback
      if (onRetry) {
        onRetry(attempt + 1, error, delayMs);
      }

      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Check if an error is a transient network/service error that should be retried
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("socket hang up") ||
      message.includes("network") ||
      message.includes("dns")
    ) {
      return true;
    }

    // HTTP status codes that indicate transient errors
    const statusMatch = message.match(/status[:\s]+(\d{3})/i);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      // 429 (rate limit), 502/503/504 (server errors) are retryable
      return status === 429 || status >= 502;
    }

    // Azure Service Bus specific transient errors
    if (
      message.includes("servicebusyexception") ||
      message.includes("serverbusy") ||
      message.includes("operationtimeout")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Create a retry wrapper with preset configuration
 *
 * @example
 * ```ts
 * const retryWithLogging = createRetryWrapper({
 *   maxRetries: 5,
 *   onRetry: (attempt, error) => logger.warn(`Retry ${attempt}`, { error }),
 * });
 *
 * await retryWithLogging(() => sendMessage());
 * ```
 */
export function createRetryWrapper(defaultConfig: RetryConfig) {
  return <T>(fn: () => Promise<T>, overrides?: RetryConfig): Promise<T> => {
    return withRetry(fn, { ...defaultConfig, ...overrides });
  };
}
