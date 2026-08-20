import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const audit = vi.fn()
const dbSelectLimit = vi.fn()
const dbDeleteWhere = vi.fn()

// Rows returned by the db.select().from(suppressions).where().limit() chain
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
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn((...args: unknown[]) => {
              dbSelectLimit(...args)
              return Promise.resolve(suppressionRows)
            }),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn((...args: unknown[]) => {
          dbDeleteWhere(...args)
          return Promise.resolve()
        }),
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

const VALID_UUID = '00000000-0000-0000-0000-000000000001'

describe('DELETE /api/internal/suppressions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suppressionRows = []
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('returns 401 when no Cf-Access-Jwt-Assertion header is present', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      `/api/internal/suppressions/${VALID_UUID}`,
      { method: 'DELETE' },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not authenticated' })
  })

  it('returns 400 when :id is not a valid UUID', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions/not-a-uuid',
      { method: 'DELETE', headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Invalid') })
  })

  it('returns 404 when the suppression row does not exist', async () => {
    suppressionRows = []
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      `/api/internal/suppressions/${VALID_UUID}`,
      { method: 'DELETE', headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Suppression not found' })
    expect(dbDeleteWhere).not.toHaveBeenCalled()
  })

  it('deletes the row and writes an audit log entry on success', async () => {
    const suppressionRow = {
      id: VALID_UUID,
      email: 'test@example.com',
      scope: 'global',
      product_id: null,
      reason: 'manual',
      source: 'manual',
      created_at: '2026-01-01T00:00:00.000Z',
    }
    suppressionRows = [suppressionRow]

    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const env = baseEnv()
    const res = await app.request(
      `/api/internal/suppressions/${VALID_UUID}`,
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Delete was called on D1
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1)

    // KV hot cache was also invalidated so the suppression actually clears
    expect(env.SUPPRESSIONS.delete).toHaveBeenCalledWith('supp:global:test@example.com')

    // Audit was written with the correct shape
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'suppression.removed',
      'suppression',
      VALID_UUID,
      suppressionRow,
      null,
    )
  })
})
