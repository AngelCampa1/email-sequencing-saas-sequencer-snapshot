import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const audit = vi.fn()

let firstRows: Array<Record<string, unknown>> = []
let preparedSql: string[] = []
let runBinds: unknown[][] = []

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
  }
})

function makeDb() {
  return {
    prepare: vi.fn((sql: string) => {
      preparedSql.push(sql)
      return {
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => firstRows.shift() ?? null),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => {
            runBinds.push(args)
            return { success: true, meta: { changes: 1 } }
          }),
        })),
        first: vi.fn(async () => firstRows.shift() ?? null),
        all: vi.fn(async () => ({ results: [] })),
      }
    }),
  }
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

const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'valid.jwt',
}

const VALID_UUID = '00000000-0000-0000-0000-000000000001'

describe('DELETE /api/internal/contacts/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firstRows = []
    preparedSql = []
    runBinds = []
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('returns 401 when dashboard access is missing', async () => {
    const app = await makeApp()

    const res = await app.request(
      `/api/internal/contacts/${VALID_UUID}`,
      { method: 'DELETE' },
      baseEnv(),
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when contact id is not a UUID', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts/not-a-uuid',
      { method: 'DELETE', headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid contact id' })
  })

  it('returns 404 when the contact does not exist', async () => {
    const app = await makeApp()

    const res = await app.request(
      `/api/internal/contacts/${VALID_UUID}`,
      { method: 'DELETE', headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Contact not found' })
  })

  it('removes contact-owned rows and writes an audit entry', async () => {
    const contact = {
      id: VALID_UUID,
      email: 'delete@example.com',
      first_name: 'Delete',
      last_name: 'Me',
      properties: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    firstRows = [contact]
    const app = await makeApp()
    const env = baseEnv()

    const res = await app.request(
      `/api/internal/contacts/${VALID_UUID}`,
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_events')
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_steps')
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_sequence_runs')
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_list_members')
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_contact_products')
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_contact_sources')
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_contacts')
    expect(runBinds).toEqual(expect.arrayContaining([[VALID_UUID]]))
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'contact.deleted',
      'contact',
      VALID_UUID,
      contact,
      null,
    )
  })
})
