import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  desc: (column: unknown) => ({ op: 'desc', column }),
  ne: (column: unknown, value: unknown) => ({ op: 'ne', column, value }),
  isNull: (column: unknown) => ({ op: 'isNull', column }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          offset: vi.fn(() => Promise.resolve([])),
        })),
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
            offset: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
  })),
  products: { __name: 'products' },
  sequences: { __name: 'sequences' },
  suppressions: { __name: 'suppressions' },
  audit_log: { __name: 'audit_log' },
  domain_health: { __name: 'domain_health' },
  instantly_campaigns: { __name: 'instantly_campaigns' },
}))

vi.mock('../lib/suppression', () => ({
  addSuppression: vi.fn(),
  removeSuppression: vi.fn(),
}))

vi.mock('../lib/run-control', () => ({
  cancelActiveRunsForSuppression: vi.fn(),
}))

vi.mock('../lib/audit', () => ({
  audit: vi.fn(),
}))

vi.mock('../lib/lead-magnet-assets', () => ({
  DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET: 'sequencer-assets',
  getLeadMagnetR2Bucket: vi.fn(() => null),
  isSupportedLeadMagnetR2Bucket: vi.fn(() => false),
}))

vi.mock('../lib/template-renderer', () => ({
  isRenderableTemplate: vi.fn(async () => false),
}))

vi.mock('../lib/email-branding', () => ({
  buildEmailTemplateProps: vi.fn(async () => ({})),
}))

vi.mock('../lib/access', () => ({
  requireDashboardAccessJwt: vi.fn(async (_token: string, _env: unknown) => ({
    email: 'operator@example.com',
  })),
  DashboardAccessForbiddenError: class DashboardAccessForbiddenError extends Error {},
}))

// Captures the last SQL and bind args issued to DB.prepare().bind().all()
let capturedSql = ''
let capturedBindArgs: unknown[] = []

function makeDb() {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => {
        capturedSql = sql
        capturedBindArgs = args
        return {
          all: vi.fn(async () => ({ results: [] })),
          first: vi.fn(async () => null),
          run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
        }
      }),
      all: vi.fn(async () => ({ results: [] })),
      first: vi.fn(async () => null),
    })),
  }
}

const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'valid.jwt',
}

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    CF_ACCESS_TEAM_NAME: 'sequencer-test',
    CF_ACCESS_AUD: 'dashboard-aud',
    DB: makeDb(),
    ANALYTICS: { writeDataPoint: vi.fn() },
    EVENTS_QUEUE: { send: vi.fn() },
    SESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    SUPPRESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ASSETS_BUCKET: { get: vi.fn() },
    ...overrides,
  }
}

async function makeApp() {
  const { internalRoute } = await import('../routes/internal/index')
  const app = new Hono()
  app.route('/api/internal', internalRoute)
  return app
}

describe('GET /api/internal/contacts — filtering, search, and sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedSql = ''
    capturedBindArgs = []
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('default request uses ORDER BY c.created_at DESC with stable tiebreaker', async () => {
    const app = await makeApp()

    const res = await app.request('/api/internal/contacts', { headers: accessHeaders }, baseEnv())

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('ORDER BY c.created_at DESC, c.id ASC')
    // No name predicates beyond the base search (searchPattern is null)
    expect(capturedBindArgs[0]).toBeNull()
  })

  it('?q=ann binds %ann% for email, first_name, and last_name', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?q=ann',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    // searchPattern bound 4 times: once for IS NULL check, then for email, first_name, last_name
    expect(capturedBindArgs[0]).toBe('%ann%')
    expect(capturedBindArgs[1]).toBe('%ann%')
    expect(capturedBindArgs[2]).toBe('%ann%')
    expect(capturedBindArgs[3]).toBe('%ann%')
    expect(capturedSql).toContain('c.first_name LIKE ? ESCAPE')
    expect(capturedSql).toContain('c.last_name LIKE ? ESCAPE')
  })

  it('?product=floriva-web adds an EXISTS subquery against seq_contact_products/seq_products and binds the slug', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?product=floriva-web',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('EXISTS')
    expect(capturedSql).toContain('seq_contact_products cp2')
    expect(capturedSql).toContain('seq_products p2')
    expect(capturedSql).toContain('p2.slug = ?')
    // productSlug bound twice (IS NULL check + actual slug)
    expect(capturedBindArgs).toContain('floriva-web')
    const florivaOccurrences = capturedBindArgs.filter((a) => a === 'floriva-web').length
    expect(florivaOccurrences).toBe(2)
  })

  it('?active_sequence=welcome filters to contacts with that running sequence', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?active_sequence=welcome',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('seq_sequence_runs ar_filter')
    expect(capturedSql).toContain("ar_filter.status = 'running'")
    expect(capturedSql).toContain('ar_filter.sequence_slug = ?')
    expect(capturedBindArgs).toContain('welcome')
  })

  it('?active_sequence=any filters to contacts with at least one running sequence', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?active_sequence=any',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('seq_sequence_runs ar_filter')
    expect(capturedSql).toContain("ar_filter.status = 'running'")
    expect(capturedSql).not.toContain('ar_filter.sequence_slug = ?')
    expect(capturedBindArgs).not.toContain('any')
  })

  it('?active_sequence=none filters to contacts without a running sequence', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?active_sequence=none',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('NOT EXISTS')
    expect(capturedSql).toContain('seq_sequence_runs ar_filter')
    expect(capturedSql).toContain("ar_filter.status = 'running'")
    expect(capturedBindArgs).not.toContain('none')
  })

  it('?sort=email&dir=asc uses ORDER BY c.email ASC', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?sort=email&dir=asc',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('ORDER BY c.email ASC')
  })

  it('?sort=name uses ORDER BY c.first_name and c.last_name', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?sort=name',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('c.first_name')
    expect(capturedSql).toContain('c.last_name')
  })

  it('invalid ?sort=DROP&dir=hack falls back to c.created_at DESC (whitelist enforcement)', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?sort=DROP&dir=hack',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(capturedSql).toContain('ORDER BY c.created_at DESC')
    expect(capturedSql).not.toContain('DROP')
    expect(capturedSql).not.toContain('hack')
  })

  it('?q=ann&product=floriva-web applies both search and product filter together', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts?q=ann&product=floriva-web',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    // search pattern present 4 times
    const annOccurrences = capturedBindArgs.filter((a) => a === '%ann%').length
    expect(annOccurrences).toBe(4)
    // product slug present 2 times
    const florivaOccurrences = capturedBindArgs.filter((a) => a === 'floriva-web').length
    expect(florivaOccurrences).toBe(2)
    expect(capturedSql).toContain('c.first_name LIKE ? ESCAPE')
    expect(capturedSql).toContain('c.last_name LIKE ? ESCAPE')
    expect(capturedSql).toContain('EXISTS')
    expect(capturedSql).toContain('p2.slug = ?')
  })

  it('returns an array (not wrapped object)', async () => {
    const app = await makeApp()

    const res = await app.request('/api/internal/contacts', { headers: accessHeaders }, baseEnv())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 401 when no Cf-Access-Jwt-Assertion header is present', async () => {
    const app = await makeApp()

    const res = await app.request('/api/internal/contacts', {}, baseEnv())

    expect(res.status).toBe(401)
  })
})
