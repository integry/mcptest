export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
  shouldRetry?: (error: Error) => boolean;
  abortSignal?: AbortSignal;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry' | 'abortSignal'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Check if aborted before attempting
      if (opts.abortSignal?.aborted) {
        throw new Error('Operation aborted');
      }

      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry if aborted
      if (opts.abortSignal?.aborted || error.message === 'Operation aborted') {
        throw error;
      }

      // Check if we should retry this error
      if (opts.shouldRetry && !opts.shouldRetry(error)) {
        throw error;
      }

      // Don't retry if this is the last attempt
      if (attempt === opts.maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const baseDelay = opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
      const delayMs = Math.min(baseDelay, opts.maxDelayMs);

      // Call retry callback if provided
      if (opts.onRetry) {
        opts.onRetry(attempt, error, delayMs);
      }

      // Wait before next attempt
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, delayMs);

        // Handle abort signal
        if (opts.abortSignal) {
          const abortHandler = () => {
            clearTimeout(timeoutId);
            reject(new Error('Operation aborted'));
          };
          opts.abortSignal.addEventListener('abort', abortHandler, { once: true });
        }
      });
    }
  }

  throw lastError!;
}

// Helper to determine if an error is retryable
export function isRetryableError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  
  // Network-related errors that are often transient
  const retryablePatterns = [
    'network request failed',
    'failed to fetch',
    'timeout',
    'timed out',
    'etimedout',
    'econnrefused',
    'econnreset',
    'enotfound',
    'enetunreach',
    'unable to connect',
    'socket hang up',
    'connection reset',
    'connection refused',
  ];

  // Don't retry CORS errors - they won't resolve with retry
  const nonRetryablePatterns = [
    'cors',
    'cross-origin',
    'access-control',
  ];

  // Check if it's non-retryable
  if (nonRetryablePatterns.some(pattern => message.includes(pattern))) {
    return false;
  }

  // Check if it's retryable
  return retryablePatterns.some(pattern => message.includes(pattern));
}