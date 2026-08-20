import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const audit = vi.fn()

let firstRows: Array<Record<string, unknown> | null> = []
let preparedSql: string[] = []
let runBinds: unknown[][] = []

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('../lib/audit', () => ({
  audit,
}))

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
  'Content-Type': 'application/json',
}

const CONTACT_ID = '00000000-0000-0000-0000-000000000001'

function enrichedContact(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Smith',
    properties: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    memberships_json: '[]',
    active_run_json: null,
    active_runs_json: '[]',
    ...overrides,
  }
}

describe('contact create/update routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firstRows = []
    preparedSql = []
    runBinds = []
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('creates a contact, attaches an optional product membership, and writes audit state', async () => {
    const app = await makeApp()
    const env = baseEnv()
    const created = enrichedContact({
      memberships_json: JSON.stringify([
        {
          product_id: 'prod_1',
          product_slug: 'camaudit',
          product_name: 'CAMAudit',
          status: 'active',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
    })
    firstRows = [{ id: 'prod_1', slug: 'camaudit', name: 'CAMAudit' }, created]

    const res = await app.request(
      '/api/internal/contacts',
      {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({
          email: ' Alice@Example.COM ',
          first_name: ' Alice ',
          last_name: ' Smith ',
          product_id: 'prod_1',
        }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      id: CONTACT_ID,
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      memberships: [expect.objectContaining({ product_id: 'prod_1' })],
    })
    expect(preparedSql.join('\n')).toContain('INSERT INTO seq_contacts')
    expect(preparedSql.join('\n')).toContain('INSERT INTO seq_contact_products')
    expect(runBinds).toEqual(
      expect.arrayContaining([
        [expect.any(String), 'alice@example.com', 'Alice', 'Smith', null],
        [expect.any(String), expect.any(String), 'prod_1', 'Alice', 'Smith', 'active'],
      ]),
    )
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'contact.created',
      'contact',
      expect.any(String),
      null,
      expect.objectContaining({ email: 'alice@example.com' }),
    )
  })

  it('rejects invalid contact create payloads before inserting', async () => {
    const app = await makeApp()

    const res = await app.request(
      '/api/internal/contacts',
      {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({ email: 'not-email', first_name: 42 }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('email') })
    expect(runBinds).toEqual([])
  })

  it('updates editable contact identity fields and writes audit state', async () => {
    const app = await makeApp()
    const env = baseEnv()
    const existing = {
      id: CONTACT_ID,
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      properties: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    const updated = enrichedContact({
      email: 'alice.updated@example.com',
      first_name: 'Alicia',
      last_name: null,
      updated_at: '2026-01-02T00:00:00.000Z',
    })
    firstRows = [existing, updated]

    const res = await app.request(
      `/api/internal/contacts/${CONTACT_ID}`,
      {
        method: 'PATCH',
        headers: accessHeaders,
        body: JSON.stringify({
          email: ' Alice.Updated@Example.com ',
          first_name: ' Alicia ',
          last_name: '',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id: CONTACT_ID,
      email: 'alice.updated@example.com',
      first_name: 'Alicia',
      last_name: null,
    })
    expect(preparedSql.join('\n')).toContain('UPDATE seq_contacts')
    expect(runBinds).toContainEqual(['alice.updated@example.com', 'Alicia', null, null, CONTACT_ID])
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'contact.updated',
      'contact',
      CONTACT_ID,
      existing,
      expect.objectContaining({ email: 'alice.updated@example.com' }),
    )
  })
})
