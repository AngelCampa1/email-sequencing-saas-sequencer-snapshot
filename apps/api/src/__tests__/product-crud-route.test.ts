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

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod_acme',
    slug: 'acme',
    name: 'Acme Mailer',
    brand_color: '#ff0000',
    default_from_email: 'hi@acme.test',
    default_reply_to: null,
    resend_api_key_secret_name: 'RESEND_ACME',
    suppression_scope: 'global',
    firewall_partner_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
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

describe('product CRUD routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('creates a product and writes audit state', async () => {
    const created = productRow()
    const { env, preparedSql, binds, run } = envWithDb([created])

    const res = await appRequest(
      '/api/internal/products',
      {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({
          slug: 'acme',
          name: ' Acme Mailer ',
          brand_color: '#ff0000',
          default_from_email: 'hi@acme.test',
          default_reply_to: '',
          resend_api_key_secret_name: 'RESEND_ACME',
          suppression_scope: 'global',
        }),
      },
      env,
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(created)
    expect(preparedSql.join('\n')).toContain('INSERT INTO seq_products')
    expect(binds).toContainEqual([
      'prod_acme',
      'acme',
      'Acme Mailer',
      '#ff0000',
      'hi@acme.test',
      null,
      'RESEND_ACME',
      'global',
      null,
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'product.created',
      'product',
      'prod_acme',
      null,
      created,
    )
  })

  it('rejects invalid create payloads before inserting', async () => {
    const { env, run } = envWithDb([])

    const res = await appRequest(
      '/api/internal/products',
      {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({ slug: 'bad slug', name: '', default_from_email: 'nope' }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('slug') })
    expect(run).not.toHaveBeenCalled()
  })

  it('updates editable product fields and writes audit state', async () => {
    const existing = productRow()
    const updated = productRow({
      name: 'Acme Updated',
      default_reply_to: 'reply@acme.test',
      suppression_scope: 'product',
    })
    const { env, preparedSql, binds, run } = envWithDb([existing, updated])

    const res = await appRequest(
      '/api/internal/products/prod_acme',
      {
        method: 'PATCH',
        headers: accessHeaders,
        body: JSON.stringify({
          name: 'Acme Updated',
          default_reply_to: 'reply@acme.test',
          suppression_scope: 'product',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(updated)
    expect(preparedSql.join('\n')).toContain('UPDATE seq_products')
    expect(binds).toContainEqual([
      'acme',
      'Acme Updated',
      '#ff0000',
      'hi@acme.test',
      'reply@acme.test',
      'RESEND_ACME',
      'product',
      null,
      'prod_acme',
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'product.updated',
      'product',
      'prod_acme',
      existing,
      updated,
    )
  })

  it('rejects a missing firewall partner before updating product guard settings', async () => {
    const existing = productRow()
    const { env, run } = envWithDb([existing, null])

    const res = await appRequest(
      '/api/internal/products/prod_acme',
      {
        method: 'PATCH',
        headers: accessHeaders,
        body: JSON.stringify({ firewall_partner_id: 'prod_missing' }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'firewall_partner_id must reference an existing product',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 409 instead of deleting a product with dependencies', async () => {
    const existing = productRow()
    const { env, run } = envWithDb([existing, { count: 2 }])

    const res = await appRequest(
      '/api/internal/products/prod_acme',
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Product has related data and cannot be deleted' })
    expect(run).not.toHaveBeenCalled()
  })

  it('checks all product-owned dashboard data before deleting a product', async () => {
    const existing = productRow()
    const { env, preparedSql } = envWithDb([existing, { count: 0 }])

    await appRequest(
      '/api/internal/products/prod_acme',
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    const sql = preparedSql.join('\n')
    expect(sql).toContain('FROM seq_contact_sources')
    expect(sql).toContain('FROM seq_instantly_campaigns')
    expect(sql).toContain('FROM seq_lists')
    expect(sql).toContain('FROM seq_templates')
  })

  it('deletes an unused product and writes audit state', async () => {
    const existing = productRow()
    const { env, preparedSql, run } = envWithDb([existing, { count: 0 }])

    const res = await appRequest(
      '/api/internal/products/prod_acme',
      { method: 'DELETE', headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(preparedSql.join('\n')).toContain('DELETE FROM seq_products')
    expect(run).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'product.deleted',
      'product',
      'prod_acme',
      existing,
      null,
    )
  })
})
