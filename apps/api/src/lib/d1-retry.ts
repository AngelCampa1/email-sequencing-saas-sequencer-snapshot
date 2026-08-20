/**
 * Cloudflare D1 occasionally rejects an otherwise-valid statement with a
 * transient `D1_ERROR` when its backing storage object is briefly unavailable
 * (cold start, storage relocation, or a Durable Object code update). These are
 * not query bugs — re-running the same statement succeeds. We retry that narrow
 * class of errors and let everything else (constraint violations, bad SQL,
 * sustained outages) propagate so real problems still surface.
 */
const TRANSIENT_D1_MESSAGE_FRAGMENTS = [
  'caused object to be reset',
  'internal error while starting up d1',
  'network connection lost',
  'reset because its code was updated',
]

export function isTransientD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message) return false
  const normalized = message.toLowerCase()
  return TRANSIENT_D1_MESSAGE_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

export interface D1RetryOptions {
  /** Total attempts including the first try. Default 3. */
  attempts?: number
  /** Base backoff in milliseconds; doubled before each subsequent retry. Default 100. */
  baseDelayMs?: number
  /** Invoked before each retry, e.g. for logging. */
  onRetry?: (error: unknown, attempt: number) => void
  /** Injectable sleep, primarily for tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run a D1 operation, retrying only transient D1 errors with exponential
 * backoff. Non-transient errors are rethrown immediately. The wrapped op must
 * be idempotent (each call re-issues the full statement).
 */
export async function withD1Retry<T>(
  op: () => Promise<T>,
  options: D1RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const baseDelayMs = options.baseDelayMs ?? 100
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; attempt < attempts; attempt++) {
    try {
      return await op()
    } catch (error) {
      if (!isTransientD1Error(error)) throw error
      options.onRetry?.(error, attempt)
      await sleep(baseDelayMs * 2 ** (attempt - 1))
    }
  }
  // Final attempt: let its result or error propagate directly.
  return op()
}
