import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const audit = vi.fn()
// Captures the last .where() call argument (the Drizzle predicate object)
const dbSelectWhere = vi.fn()
const dbSelectLimit = vi.fn()
const dbSelectOffset = vi.fn()

// Rows that the fake DB returns for suppression selects
let suppressionRows: Array<Record<string, unknown>> = []

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('../lib/audit', () => ({
  audit,
}))

vi.mock('@sequencer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sequencer/db')>()
  return {
    ...actual,
    createDb: vi.fn(() => ({
      select: vi.fn(() => {
        const query = {
          from: vi.fn(() => query),
          where: vi.fn((predicate: unknown) => {
            dbSelectWhere(predicate)
            return query
          }),
          orderBy: vi.fn(() => query),
          limit: vi.fn((limit: unknown) => {
            dbSelectLimit(limit)
            return query
          }),
          offset: vi.fn((offset: unknown) => {
            dbSelectOffset(offset)
            return Promise.resolve(suppressionRows)
          }),
        }
        return query
      }),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  }
})

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    CF_ACCESS_TEAM_NAME: 'sequencer-test',
    CF_ACCESS_AUD: 'dashboard-aud',
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ success: true })),
          all: vi.fn(async () => ({ results: [] })),
          first: vi.fn(async () => null),
        })),
      })),
    },
    ANALYTICS: { writeDataPoint: vi.fn() },
    EVENTS_QUEUE: { send: vi.fn() },
    SESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    SUPPRESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ASSETS_BUCKET: { get: vi.fn() },
    ...overrides,
  }
}

const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'valid.jwt',
}

/**
 * Safe recursive string-value extractor for Drizzle predicate objects.
 * Drizzle expression objects are circular (a Column holds a ref back to its
 * Table), so JSON.stringify is not safe. We walk every own-enumerable property
 * of every object/array node — the WeakSet guards against the circular refs —
 * and collect every string scalar we encounter, including the bound `Param`
 * values stored inside an SQL node's `queryChunks`.
 */
function extractPredicateStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractPredicateStrings(item, seen))
  }
  return Object.values(value as Record<string, unknown>).flatMap((v) =>
    extractPredicateStrings(v, seen),
  )
}

describe('GET /api/internal/suppressions — email search filter (q)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suppressionRows = []
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('returns all rows with no filters applied when neither scope nor q is provided', async () => {
    suppressionRows = [
      { id: 's1', email: 'alice@example.com', scope: 'global', created_at: '2026-01-01T00:00:00Z' },
      { id: 's2', email: 'bob@example.com', scope: 'product', created_at: '2026-01-02T00:00:00Z' },
    ]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(suppressionRows)
    // No predicate is passed when there are no filters
    expect(dbSelectWhere).toHaveBeenCalledWith(undefined)
  })

  it('passes an email LIKE predicate when q is provided without scope', async () => {
    suppressionRows = [
      { id: 's1', email: 'foo@bar.com', scope: 'global', created_at: '2026-01-01T00:00:00Z' },
    ]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions?q=foo',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(suppressionRows)

    // A non-undefined predicate was passed (the LIKE filter)
    expect(dbSelectWhere).toHaveBeenCalled()
    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    // The predicate should contain the escaped pattern string %foo%
    const strings = extractPredicateStrings(predicate)
    expect(strings).toContain('%foo%')
    // The generated SQL must carry an ESCAPE clause so the escaped pattern
    // matches literally in SQLite.
    expect(strings.join(' ').toLowerCase()).toContain('escape')
  })

  it('escapes LIKE special characters in q before building the pattern', async () => {
    suppressionRows = []
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/suppressions?q=foo%25_bar',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    const strings = extractPredicateStrings(predicate)
    // % and _ in q must be escaped so they match literally
    expect(strings).toContain('%foo\\%\\_bar%')
  })

  it('passes a combined and() predicate when both scope and q are provided', async () => {
    suppressionRows = []
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/suppressions?scope=global&q=foo',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const strings = extractPredicateStrings(predicate)
    // Should contain both the scope value and the email pattern
    expect(strings).toContain('global')
    expect(strings).toContain('%foo%')
  })

  it('applies a scope-only predicate when scope is provided without q', async () => {
    suppressionRows = []
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/suppressions?scope=product',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const strings = extractPredicateStrings(predicate)
    expect(strings).toContain('product')
    // Should NOT contain any % pattern (no LIKE)
    expect(strings.some((s) => s.includes('%'))).toBe(false)
  })

  it('still honours limit and offset clamping when q is present', async () => {
    suppressionRows = []
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/suppressions?q=test&limit=999&offset=2000',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(dbSelectLimit).toHaveBeenCalledWith(500) // clamped to max 500
    expect(dbSelectOffset).toHaveBeenCalledWith(1000) // clamped to max 1000
  })

  it('rejects invalid scope even when q is also provided', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions?scope=all&q=foo',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'scope must be global or product' })
    expect(dbSelectWhere).not.toHaveBeenCalled()
  })

  it('returns 401 when no auth header is present', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request('/api/internal/suppressions', {}, baseEnv())

    expect(res.status).toBe(401)
  })
})
