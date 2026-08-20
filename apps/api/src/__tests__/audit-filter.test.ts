import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const audit = vi.fn()
const dbSelectWhere = vi.fn()
const dbSelectLimit = vi.fn()
const dbSelectOffset = vi.fn()

// Rows that the fake DB returns for audit selects
let auditRows: Array<Record<string, unknown>> = []

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
            return Promise.resolve(auditRows)
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

function makeAuditEntry(index: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `audit_${index}`,
    actor: 'system',
    action: 'sequence.run',
    target_type: 'sequence',
    target_id: null,
    before: null,
    after: null,
    at: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`,
    ...overrides,
  }
}

/**
 * Safe recursive string-value extractor for Drizzle predicate objects.
 * JSON.stringify throws on Drizzle's circular SQL/Column nodes, so we walk
 * every own-enumerable property (the WeakSet guards the circular refs) and
 * collect every string scalar, including the bound `Param` values inside an
 * SQL node's `queryChunks`. Joined into one string so callers keep substring
 * semantics for toContain / not.toContain.
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

describe('GET /api/internal/audit — actor/action/date filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auditRows = []
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('returns 401 when no auth header is present', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request('/api/internal/audit', {}, baseEnv())

    expect(res.status).toBe(401)
  })

  it('passes undefined where when no filters are provided', async () => {
    auditRows = [makeAuditEntry(1)]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request('/api/internal/audit', { headers: accessHeaders }, baseEnv())

    expect(res.status).toBe(200)
    expect(dbSelectWhere).toHaveBeenCalledWith(undefined)
  })

  it('passes an actor eq predicate when ?actor is provided', async () => {
    auditRows = [makeAuditEntry(1, { actor: 'a@b.com' })]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request('/api/internal/audit?actor=a%40b.com', { headers: accessHeaders }, baseEnv())

    expect(dbSelectWhere).toHaveBeenCalled()
    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('a@b.com')
  })

  it('passes an action eq predicate when ?action is provided', async () => {
    auditRows = [makeAuditEntry(1, { action: 'suppression.removed' })]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/audit?action=suppression.removed',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('suppression.removed')
  })

  it('passes a from gte predicate when ?from is provided', async () => {
    auditRows = [makeAuditEntry(5)]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request('/api/internal/audit?from=2026-01-01', { headers: accessHeaders }, baseEnv())

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('2026-01-01')
  })

  it('appends T23:59:59.999Z to bare date ?to values to make them day-inclusive', async () => {
    auditRows = [makeAuditEntry(1)]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request('/api/internal/audit?to=2026-01-31', { headers: accessHeaders }, baseEnv())

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('2026-01-31T23:59:59.999Z')
  })

  it('does not modify ?to values that already include a time component', async () => {
    auditRows = [makeAuditEntry(1)]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/audit?to=2026-01-31T12:00:00.000Z',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('2026-01-31T12:00:00.000Z')
    // Must not have had end-of-day appended
    expect(predicateStr).not.toContain('T23:59:59.999Z')
  })

  it('builds a combined and() predicate when from and to are both provided', async () => {
    auditRows = [makeAuditEntry(15)]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/audit?from=2026-01-01&to=2026-01-31',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('2026-01-01')
    expect(predicateStr).toContain('2026-01-31T23:59:59.999Z')
  })

  it('combines all four filters into a single and() predicate', async () => {
    auditRows = [makeAuditEntry(5, { actor: 'a@b.com', action: 'suppression.removed' })]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request(
      '/api/internal/audit?actor=a%40b.com&action=suppression.removed&from=2026-01-01&to=2026-01-31',
      { headers: accessHeaders },
      baseEnv(),
    )

    const predicate = dbSelectWhere.mock.calls[0][0]
    expect(predicate).not.toBeUndefined()
    const predicateStr = extractPredicateStrings(predicate).join('\n')
    expect(predicateStr).toContain('a@b.com')
    expect(predicateStr).toContain('suppression.removed')
    expect(predicateStr).toContain('2026-01-01')
    expect(predicateStr).toContain('2026-01-31T23:59:59.999Z')
  })

  it('still returns { entries, has_next } with pagination when filters are applied', async () => {
    // 51 rows triggers has_next: true (page size is 50, lookahead fetches 51)
    auditRows = Array.from({ length: 51 }, (_, i) => makeAuditEntry(i + 1))
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/audit?actor=system',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: unknown[]; has_next: boolean }
    expect(body.entries).toHaveLength(50)
    expect(body.has_next).toBe(true)
    expect(dbSelectLimit).toHaveBeenCalledWith(51) // pageSize + 1 lookahead
  })

  it('reports has_next: false when filtered results fit in one page', async () => {
    auditRows = Array.from({ length: 3 }, (_, i) => makeAuditEntry(i + 1))
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/audit?action=suppression.removed',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: unknown[]; has_next: boolean }
    expect(body.entries).toHaveLength(3)
    expect(body.has_next).toBe(false)
  })

  it('applies the correct page offset when page > 1', async () => {
    auditRows = [makeAuditEntry(1)]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    await app.request('/api/internal/audit?page=3', { headers: accessHeaders }, baseEnv())

    expect(dbSelectOffset).toHaveBeenCalledWith(100) // (3 - 1) * 50
  })
})
