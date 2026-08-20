import { describe, expect, it, vi } from 'vitest'
import { isTransientD1Error, withD1Retry } from './d1-retry'

const RESET_ERROR = new Error(
  'D1_ERROR: Internal error while starting up D1 DB storage caused object to be reset; reference = ; wdErrId = tjpk3asisji8g1rn9bnatdug',
)

describe('isTransientD1Error', () => {
  it('flags the D1 storage-reset internal error as transient', () => {
    expect(isTransientD1Error(RESET_ERROR)).toBe(true)
  })

  it('flags other known transient D1 conditions regardless of case', () => {
    expect(isTransientD1Error(new Error('D1_ERROR: Network connection lost.'))).toBe(true)
    expect(
      isTransientD1Error(new Error('The Durable Object reset because its code was updated.')),
    ).toBe(true)
  })

  it('accepts transient messages passed as plain strings', () => {
    expect(isTransientD1Error('caused object to be reset')).toBe(true)
  })

  it('does not flag genuine query errors as transient', () => {
    expect(isTransientD1Error(new Error('D1_ERROR: no such column: bogus'))).toBe(false)
    expect(isTransientD1Error(new Error('UNIQUE constraint failed'))).toBe(false)
  })

  it('does not flag non-error, empty, or nullish values', () => {
    expect(isTransientD1Error(null)).toBe(false)
    expect(isTransientD1Error(undefined)).toBe(false)
    expect(isTransientD1Error(42)).toBe(false)
    expect(isTransientD1Error('')).toBe(false)
  })
})

describe('withD1Retry', () => {
  const noSleep = vi.fn(async () => {})

  it('returns the result without retrying when the op succeeds', async () => {
    const op = vi.fn(async () => 'ok')

    await expect(withD1Retry(op, { sleep: noSleep })).resolves.toBe('ok')

    expect(op).toHaveBeenCalledTimes(1)
    expect(noSleep).not.toHaveBeenCalled()
  })

  it('retries transient failures and resolves once the op recovers', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(RESET_ERROR)
      .mockRejectedValueOnce(RESET_ERROR)
      .mockResolvedValueOnce('recovered')
    const onRetry = vi.fn()
    const sleep = vi.fn(async () => {})

    await expect(withD1Retry(op, { baseDelayMs: 10, onRetry, sleep })).resolves.toBe('recovered')

    expect(op).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, RESET_ERROR, 1)
    expect(sleep).toHaveBeenNthCalledWith(1, 10)
    expect(sleep).toHaveBeenNthCalledWith(2, 20)
  })

  it('rethrows non-transient errors immediately without retrying', async () => {
    const fatal = new Error('D1_ERROR: no such table: seq_instantly_campaigns')
    const op = vi.fn(async () => {
      throw fatal
    })

    await expect(withD1Retry(op, { sleep: noSleep })).rejects.toBe(fatal)

    expect(op).toHaveBeenCalledTimes(1)
    expect(noSleep).not.toHaveBeenCalled()
  })

  it('gives up after exhausting attempts and rethrows the last transient error', async () => {
    const op = vi.fn(async () => {
      throw RESET_ERROR
    })
    const sleep = vi.fn(async () => {})

    await expect(withD1Retry(op, { attempts: 3, baseDelayMs: 1, sleep })).rejects.toBe(RESET_ERROR)

    expect(op).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('honors a single-attempt configuration by not retrying', async () => {
    const op = vi.fn(async () => {
      throw RESET_ERROR
    })
    const sleep = vi.fn(async () => {})

    await expect(withD1Retry(op, { attempts: 1, sleep })).rejects.toBe(RESET_ERROR)

    expect(op).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('falls back to a real timer-based sleep when none is injected', async () => {
    vi.useFakeTimers()
    try {
      const op = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(RESET_ERROR)
        .mockResolvedValueOnce('done')

      const promise = withD1Retry(op, { baseDelayMs: 100 })
      await vi.advanceTimersByTimeAsync(100)

      await expect(promise).resolves.toBe('done')
      expect(op).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
