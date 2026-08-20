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

function leadMagnetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    product_id: 'prod_1',
    product_slug: 'camaudit',
    product_name: 'CAMAudit',
    slug: 'tenant-checklist',
    name: 'Tenant Checklist',
    asset_r2_bucket: 'camaudit',
    asset_r2_key: 'tenant-checklist.pdf',
    fulfillment_sequence_slug: 'tenant-welcome',
    conversion_event_name: 'lead_magnet_downloaded',
    active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
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

describe('DELETE /api/internal/lead-magnets/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('rejects invalid lead magnet ids before querying', async () => {
    const { env, run } = envWithDb([])

    const res = await appRequest(
      '/api/internal/lead-magnets/not-a-uuid',
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid id' })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 409 instead of deleting a lead magnet with captured contacts', async () => {
    const existing = leadMagnetRow()
    const { env, run } = envWithDb([existing, { count: 2 }])

    const res = await appRequest(
      `/api/internal/lead-magnets/${existing.id}`,
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Lead magnet has captured contacts and cannot be deleted',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('deletes an unused lead magnet and writes audit state', async () => {
    const existing = leadMagnetRow()
    const { env, preparedSql, binds, run } = envWithDb([existing, { count: 0 }])

    const res = await appRequest(
      `/api/internal/lead-magnets/${existing.id}`,
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_lead_magnets')
    expect(binds).toContainEqual([existing.id])
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'lead_magnet.deleted',
      'lead_magnet',
      existing.id,
      {
        product_id: existing.product_id,
        slug: existing.slug,
        asset_r2_bucket: existing.asset_r2_bucket,
        asset_r2_key: existing.asset_r2_key,
        fulfillment_sequence_slug: existing.fulfillment_sequence_slug,
        conversion_event_name: existing.conversion_event_name,
        active: true,
      },
      null,
    )
  })
})
