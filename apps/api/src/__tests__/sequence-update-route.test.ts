import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const audit = vi.fn()

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('../lib/audit', () => ({
  audit,
}))

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    CF_ACCESS_TEAM_NAME: 'sequencer-test',
    CF_ACCESS_AUD: 'dashboard-aud',
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
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

function sequenceRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'welcome-flow',
    product_id: 'prod_1',
    version: 1,
    definition: { steps: [{ template: 'welcome' }] },
    goal: 'onboarding',
    exit_conditions: [{ event: 'reply_received' }],
    is_active: 1,
    compiled_at: '2026-01-01T00:00:00.000Z',
    compiled_from_sha: 'abc123',
    ...overrides,
  }
}

function envWithDb(firstRows: unknown[], runResult = { success: true, meta: { changes: 1 } }) {
  const preparedSql: string[] = []
  const binds: unknown[][] = []
  const run = vi.fn(async () => runResult)
  const first = vi.fn(async () => firstRows.shift() ?? null)
  const bind = vi.fn((...values: unknown[]) => {
    binds.push(values)
    return { run, first, all: vi.fn(async () => ({ results: [] })) }
  })
  const prepare = vi.fn((sql: string) => {
    preparedSql.push(sql)
    return { bind }
  })

  return {
    env: baseEnv({ DB: { prepare } }),
    preparedSql,
    binds,
    run,
    first,
  }
}

async function appRequest(path: string, init: RequestInit, env: Record<string, unknown>) {
  const { internalRoute } = await import('../routes/internal/index')
  const app = new Hono()
  app.route('/api/internal', internalRoute)
  return app.request(path, init, env)
}

const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'valid.jwt',
  'Content-Type': 'application/json',
}

describe('PATCH /api/internal/sequences/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('returns 401 when dashboard auth is missing', async () => {
    const res = await appRequest(
      '/api/internal/sequences/welcome-flow',
      { method: 'PATCH', body: JSON.stringify({ is_active: false }) },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not authenticated' })
  })

  it('validates the editable fields before updating', async () => {
    const { env, run } = envWithDb([sequenceRow()])

    const res = await appRequest(
      '/api/internal/sequences/welcome-flow',
      {
        method: 'PATCH',
        headers: accessHeaders,
        body: JSON.stringify({ goal: 42, is_active: 'yes', definition: [] }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('goal') })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 when the sequence does not exist', async () => {
    const { env, run } = envWithDb([null])

    const res = await appRequest(
      '/api/internal/sequences/missing-flow',
      {
        method: 'PATCH',
        headers: accessHeaders,
        body: JSON.stringify({ is_active: false }),
      },
      env,
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Sequence not found' })
    expect(run).not.toHaveBeenCalled()
  })

  it('updates goal, active status, and definition, then writes an audit entry', async () => {
    const existing = sequenceRow()
    const updated = sequenceRow({
      goal: 'activation',
      is_active: false,
      definition: { steps: [{ template: 'welcome' }, { template: 'follow-up' }] },
    })
    const { env, preparedSql, binds, run } = envWithDb([existing, updated])

    const res = await appRequest(
      '/api/internal/sequences/welcome-flow',
      {
        method: 'PATCH',
        headers: accessHeaders,
        body: JSON.stringify({
          goal: ' activation ',
          is_active: false,
          definition: updated.definition,
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(updated)
    expect(preparedSql.join('\n')).toContain('UPDATE seq_sequences')
    expect(binds).toContainEqual([
      JSON.stringify(updated.definition),
      'activation',
      0,
      'welcome-flow',
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'sequence.updated',
      'sequence',
      'welcome-flow',
      { ...existing, is_active: true },
      updated,
    )
  })
})

describe('POST /api/internal/sequences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('creates a sequence and writes an audit entry', async () => {
    const created = sequenceRow({
      slug: 'new-flow',
      product_id: 'prod_1',
      version: 1,
      definition: { steps: [] },
      goal: 'activation',
      is_active: true,
      compiled_from_sha: 'dashboard',
    })
    const { env, preparedSql, binds, run } = envWithDb([{ id: 'prod_1' }, created])

    const res = await appRequest(
      '/api/internal/sequences',
      {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({
          slug: ' new-flow ',
          product_id: 'prod_1',
          goal: ' activation ',
          is_active: true,
          definition: { steps: [] },
        }),
      },
      env,
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ...created, is_active: true })
    expect(preparedSql.join('\n')).toContain('INSERT INTO seq_sequences')
    expect(binds).toContainEqual([
      'new-flow',
      'prod_1',
      1,
      JSON.stringify({ steps: [] }),
      'activation',
      JSON.stringify([]),
      1,
      'dashboard',
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'sequence.created',
      'sequence',
      'new-flow',
      null,
      { ...created, is_active: true },
    )
  })

  it('rejects create when the product does not exist', async () => {
    const { env, run } = envWithDb([null])

    const res = await appRequest(
      '/api/internal/sequences',
      {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({
          slug: 'new-flow',
          product_id: 'missing',
          definition: { steps: [] },
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'product_id must reference an existing product' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/internal/sequences/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('refuses to delete sequences with existing runs', async () => {
    const { env, run } = envWithDb([sequenceRow(), { count: 2 }])

    const res = await appRequest(
      '/api/internal/sequences/welcome-flow',
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Sequence has runs and cannot be deleted' })
    expect(run).not.toHaveBeenCalled()
  })

  it('deletes an unused sequence and writes an audit entry', async () => {
    const existing = sequenceRow()
    const { env, preparedSql, binds, run } = envWithDb([existing, { count: 0 }])

    const res = await appRequest(
      '/api/internal/sequences/welcome-flow',
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_sequences')
    expect(binds).toContainEqual(['welcome-flow'])
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'sequence.deleted',
      'sequence',
      'welcome-flow',
      { ...existing, is_active: true },
      null,
    )
  })
})
