import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Rate limit middleware', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports rateLimitMiddleware', async () => {
    const { rateLimitMiddleware } = await import('../middleware/rate-limit')
    expect(typeof rateLimitMiddleware).toBe('function')
  })

  it('claims a new D1-backed bucket and reports remaining capacity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T10:15:00.000Z'))
    const { rateLimitMiddleware } = await import('../middleware/rate-limit')
    const env = { DB: createAtomicRateLimitDb(0) }

    const result = await rateLimitMiddleware(env as any, 'client_1.access', 'contacts')

    expect(result).toEqual({
      allowed: true,
      remaining: 999,
      resetAt: new Date('2026-05-20T11:00:00.000Z').getTime(),
    })
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT OR IGNORE INTO seq_rate_limit_windows/),
    )
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE seq_rate_limit_windows/),
    )
  })

  it('does not allow concurrent requests to overspend the last token in a window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T10:15:00.000Z'))
    const { rateLimitMiddleware } = await import('../middleware/rate-limit')
    let pendingGets = 0
    let releaseGets: (() => void) | null = null
    const bothGetsStarted = new Promise<void>((resolve) => {
      releaseGets = resolve
    })
    const put = vi.fn()
    const env = {
      SESSIONS: {
        get: vi.fn(async () => {
          pendingGets += 1
          if (pendingGets === 2) releaseGets?.()
          await bothGetsStarted
          return '999'
        }),
        put,
      },
      DB: createAtomicRateLimitDb(999),
    }

    const results = await Promise.all([
      rateLimitMiddleware(env as any, 'client_1.access', 'contacts'),
      rateLimitMiddleware(env as any, 'client_1.access', 'contacts'),
    ])

    expect(results.filter((result) => result.allowed)).toHaveLength(1)
    expect(results.filter((result) => !result.allowed)).toHaveLength(1)
  })
})

function createAtomicRateLimitDb(initialCount: number) {
  let count = initialCount
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => {
          if (/update seq_rate_limit_windows/i.test(sql)) {
            if (count >= 1000) return { meta: { changes: 0 } }
            count += 1
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 1 } }
        }),
        first: vi.fn(async () => ({ count })),
      })),
    })),
  }
}
