import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderEmailForTemplate = vi.fn()
const isRenderableTemplate = vi.fn((slug: string) => slug !== 'missing/template')
const dbInsertValues = vi.fn()
const dbInsertOnConflictDoNothing = vi.fn()
const dbInsertOnConflictDoUpdate = vi.fn()
const dbUpdateSet = vi.fn()
const dbUpdateWhere = vi.fn()
const dbSelectWhere = vi.fn()
const dbSelectLimit = vi.fn()
const dbSelectOffset = vi.fn()
const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const addSuppression = vi.fn()
const audit = vi.fn()
const instantlyListCampaigns = vi.fn()
const instantlyGetCampaignAnalytics = vi.fn()
const createInstantlyAdapter = vi.fn(() => ({
  listCampaigns: instantlyListCampaigns,
  getCampaignAnalytics: instantlyGetCampaignAnalytics,
}))
let suppressionsSelectRows: Array<Record<string, unknown>> = []
let auditSelectRows: Array<Record<string, unknown>> = []
let messageSelectRows: Array<Record<string, unknown>> = []
let productSelectRows: Array<Record<string, unknown>> = []
let contactSelectRows: Array<Record<string, unknown>> = []
let sequenceRunSelectRows: Array<Record<string, unknown>> = []
let eventSelectRows: Array<Record<string, unknown>> = []
let sequenceSelectRows: Array<Record<string, unknown>> = []
let instantlyCampaignSelectRows: Array<Record<string, unknown>> = []
let instantlyStatsSelectRows: Array<Record<string, unknown>> = []
let dbUpdateWhereResult: ((value: Record<string, unknown>, where: unknown) => unknown) | null = null

vi.mock('../lib/template-renderer', () => ({
  renderEmailForTemplate,
  isRenderableTemplate,
  TemplateNotFoundError: class TemplateNotFoundError extends Error {
    constructor(readonly templateSlug: string) {
      super(`Template not found: ${templateSlug}`)
      this.name = 'TemplateNotFoundError'
    }
  },
}))

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('../lib/suppression', () => ({
  addSuppression,
}))

vi.mock('../lib/audit', () => ({
  audit,
}))

vi.mock('../providers/instantly', () => ({
  createInstantlyAdapter,
}))

vi.mock('@sequencer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sequencer/db')>()
  return {
    ...actual,
    createDb: vi.fn(() => ({
      select: vi.fn((selection?: Record<string, unknown>) => {
        let selectedScope: string | null = null
        let selectedTable: unknown = null
        let selectedLimit: number | null = null
        let selectedWhere: unknown = null
        const query = {
          from: vi.fn((table) => {
            selectedTable = table
            return query
          }),
          innerJoin: vi.fn(() => query),
          where: vi.fn((where) => {
            dbSelectWhere(where)
            selectedWhere = where
            selectedScope = 'product'
            return query
          }),
          orderBy: vi.fn(() => query),
          limit: vi.fn((limit) => {
            dbSelectLimit(limit)
            selectedLimit = limit
            return query
          }),
          offset: vi.fn((offset) => {
            dbSelectOffset(offset)
            const rows = selectRows()
            return Promise.resolve(rows.slice(offset, offset + (selectedLimit ?? rows.length)))
          }),
          then: (
            resolve: (value: Array<Record<string, unknown>>) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve(selectRows()).then(resolve, reject),
        }
        function selectRows() {
          if (selectedTable === actual.audit_log) return auditSelectRows
          if (selectedTable === actual.messages) return messageSelectRows
          if (selectedTable === actual.products) return productSelectRows
          if (selectedTable === actual.contacts) return contactSelectRows
          if (selectedTable === actual.sequence_runs) {
            const rows = filterSequenceRunRows(selectedWhere)
            if (selection && Object.hasOwn(selection, 'total')) {
              return [{ total: rows.length }]
            }
            return rows
          }
          if (selectedTable === actual.events) return eventSelectRows
          if (selectedTable === actual.sequences) return sequenceSelectRows
          if (selectedTable === actual.instantly_campaigns) return instantlyCampaignSelectRows
          if (selectedTable === actual.instantly_campaign_daily_stats)
            return instantlyStatsSelectRows
          return selectedScope
            ? suppressionsSelectRows.filter((row) => row.scope === selectedScope)
            : suppressionsSelectRows
        }
        return query
      }),
      insert: vi.fn(() => ({
        values: vi.fn((value) => {
          dbInsertValues(value)
          return {
            onConflictDoNothing: dbInsertOnConflictDoNothing,
            onConflictDoUpdate: dbInsertOnConflictDoUpdate,
          }
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((value) => {
          dbUpdateSet(value)
          return {
            where: vi.fn((where) => {
              dbUpdateWhere(where)
              return dbUpdateWhereResult?.(value, where)
            }),
          }
        }),
      })),
    })),
  }
})

function filterSequenceRunRows(where: unknown): Array<Record<string, unknown>> {
  const filtersById = sequenceRunRowsFilterBy(where, 'id')
  const filtersByEmail = sequenceRunRowsFilterBy(where, 'email')
  const filtersByContactId = sequenceRunRowsFilterBy(where, 'contact_id')
  const filtersByProductId = sequenceRunRowsFilterBy(where, 'product_id')
  const filtersBySequenceSlug = sequenceRunRowsFilterBy(where, 'sequence_slug')
  return sequenceRunSelectRows.filter((row) => {
    if (
      filtersById &&
      typeof row.id === 'string' &&
      !expressionIncludesValue(where, row.id, new WeakSet())
    )
      return false
    if (
      filtersByEmail &&
      typeof row.email === 'string' &&
      !expressionIncludesValue(where, row.email, new WeakSet())
    )
      return false
    if (
      filtersByContactId &&
      typeof row.contact_id === 'string' &&
      !expressionIncludesValue(where, row.contact_id, new WeakSet())
    )
      return false
    if (
      filtersByProductId &&
      typeof row.product_id === 'string' &&
      !expressionIncludesValue(where, row.product_id, new WeakSet())
    )
      return false
    if (
      filtersBySequenceSlug &&
      typeof row.sequence_slug === 'string' &&
      !expressionIncludesValue(where, row.sequence_slug, new WeakSet())
    )
      return false
    return true
  })
}

function sequenceRunRowsFilterBy(where: unknown, field: string): boolean {
  const strings = expressionStringValues(where, new WeakSet())
  if (field === 'id') return strings.some((value) => value.startsWith('run_'))
  if (field === 'email') return strings.some((value) => value.includes('@'))
  if (field === 'contact_id') return strings.some((value) => value.startsWith('contact_'))
  if (field === 'product_id') return strings.some((value) => value.startsWith('prod_'))
  if (field === 'sequence_slug') return strings.some((value) => value.includes('sequence'))
  return false
}

function expressionIncludesValue(value: unknown, expected: string, seen: WeakSet<object>): boolean {
  if (value === expected) return true
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value))
    return value.some((entry) => expressionIncludesValue(entry, expected, seen))
  return Object.values(value).some((entry) => expressionIncludesValue(entry, expected, seen))
}

function expressionStringValues(value: unknown, seen: WeakSet<object>): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) return value.flatMap((entry) => expressionStringValues(entry, seen))
  return Object.values(value).flatMap((entry) => expressionStringValues(entry, seen))
}

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
    SESSIONS: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    ASSETS_BUCKET: {
      get: vi.fn(),
    },
    ...overrides,
  }
}

function envWithOverviewRows(rowsBySql: Array<[string, unknown[]]>) {
  const rowsForSql = (sql: string) =>
    [...rowsBySql].reverse().find(([pattern]) => sql.includes(pattern))?.[1] ?? []
  return baseEnv({
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({
            results: rowsForSql(sql),
          })),
          first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
        })),
        all: vi.fn(async () => ({
          results: rowsForSql(sql),
        })),
        first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
      })),
    },
  })
}

async function signResendWebhook(body: string, timestamp: string, msgId: string, secret: string) {
  const secretBytes = Buffer.from(secret.replace('whsec_', ''), 'base64')
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signedContent = `${msgId}.${timestamp}.${body}`
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  return `v1,${Buffer.from(signature).toString('base64')}`
}

const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'valid.jwt',
}

describe('internal template preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suppressionsSelectRows = []
    auditSelectRows = []
    messageSelectRows = []
    productSelectRows = []
    contactSelectRows = []
    sequenceRunSelectRows = []
    eventSelectRows = []
    sequenceSelectRows = []
    instantlyCampaignSelectRows = []
    instantlyStatsSelectRows = []
    dbUpdateWhereResult = null
    instantlyListCampaigns.mockReset()
    instantlyGetCampaignAnalytics.mockReset()
    createInstantlyAdapter.mockClear()
    isRenderableTemplate.mockImplementation((slug: string) => slug !== 'missing/template')
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('rejects requests without Cloudflare Access identity', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request('/api/internal/overview', {}, baseEnv())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not authenticated' })
  })

  it('rejects spoofed identity headers without a valid Access JWT', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/overview',
      { headers: { 'Cf-Access-Authenticated-User-Email': 'operator@example.com' } },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('rejects invalid Access JWT assertions', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('bad signature'))
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request('/api/internal/overview', { headers: accessHeaders }, baseEnv())

    expect(res.status).toBe(401)
  })

  it('rejects verified Access users outside the dashboard allowlist before dashboard side effects', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { email: 'outsider@example.com' } })
    const prepare = vi.fn()
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/overview',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      baseEnv({ DB: { prepare } }),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('renders encoded template slugs containing slashes', async () => {
    renderEmailForTemplate.mockResolvedValue({ html: '<strong>preview</strong>', text: 'preview' })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        '/* internal template preview context */',
        [
          {
            sequence_slug: 'camaudit-demo',
            version: 2,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            brand_color: '#2e7d71',
            definition: JSON.stringify({
              steps: [
                {
                  id: 'deliver',
                  template: 'lead-magnets/tenant-checklist-delivery',
                  subject: 'Checklist delivery',
                },
              ],
            }),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/templates/lead-magnets%2Ftenant-checklist-delivery/preview?product=camaudit&sequence=camaudit-demo',
      { headers: accessHeaders },
      { ...env, UNSUBSCRIBE_SIGNING_SECRET: 'test-unsubscribe-signing-secret' },
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<strong>preview</strong>')
    expect(renderEmailForTemplate).toHaveBeenCalledWith(
      'lead-magnets/tenant-checklist-delivery',
      expect.objectContaining({
        firstName: 'Preview',
        productName: 'CAMAudit',
        brandColor: '#2e7d71',
        subject: 'Checklist delivery',
        sequenceSlug: 'camaudit-demo',
      }),
    )
    const props = renderEmailForTemplate.mock.calls[0][1]
    const unsubscribeUrl = new URL(props.unsubscribeUrl)
    expect(unsubscribeUrl.pathname).toBe('/unsubscribe')
    expect(unsubscribeUrl.searchParams.get('email')).toBe('preview@example.com')
    expect(unsubscribeUrl.searchParams.get('product')).toBe('camaudit')
    expect(unsubscribeUrl.searchParams.get('sig')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(jwtVerify).toHaveBeenCalledWith(
      'valid.jwt',
      'jwks',
      expect.objectContaining({
        audience: 'dashboard-aud',
        issuer: 'https://sequencer-test.cloudflareaccess.com',
      }),
    )
  }, 10_000)

  it('rejects malformed encoded template slugs as a bad request', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/templates/%E0%A4%A/preview',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Template slug is required' })
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
  })

  it('accepts a full Cloudflare Access team domain in configuration', async () => {
    renderEmailForTemplate.mockResolvedValue({ html: '<strong>preview</strong>', text: 'preview' })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        '/* internal template preview context */',
        [
          {
            sequence_slug: 'camaudit-demo',
            version: 2,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            brand_color: '#2e7d71',
            definition: JSON.stringify({
              steps: [
                {
                  id: 'deliver',
                  template: 'lead-magnets/tenant-checklist-delivery',
                  subject: 'Checklist delivery',
                },
              ],
            }),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/templates/lead-magnets%2Ftenant-checklist-delivery/preview?product=camaudit&sequence=camaudit-demo',
      { headers: accessHeaders },
      {
        ...env,
        CF_ACCESS_TEAM_NAME: 'sequencer-test.cloudflareaccess.com',
        UNSUBSCRIBE_SIGNING_SECRET: 'test-unsubscribe-signing-secret',
      },
    )

    expect(res.status).toBe(200)
    expect(jwtVerify).toHaveBeenCalledWith(
      'valid.jwt',
      'jwks',
      expect.objectContaining({
        issuer: 'https://sequencer-test.cloudflareaccess.com',
      }),
    )
  }, 10_000)

  it('does not convert downstream route failures into authentication failures', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    internalRoute.get('/boom', () => {
      throw new Error('route failed')
    })
    app.route('/api/internal', internalRoute)

    const res = await app.request('/api/internal/boom', { headers: accessHeaders }, baseEnv())

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('returns calculated overview metrics instead of placeholder zeros', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      ['FROM seq_sequence_runs WHERE status = ?', [{ count: 4 }]],
      ['FROM seq_messages WHERE sent_at >= ?', [{ count: 10 }]],
      ['FROM seq_suppressions', [{ count: 2 }]],
      ['bounced_at IS NOT NULL', [{ count: 1 }]],
      [
        'JOIN seq_products p',
        [
          { slug: 'camaudit-lead-magnet-tenant-checklist', product: 'camaudit', enrollments: 8 },
          { slug: 'floriva-web-fulfillment-intro', product: 'floriva-web', enrollments: 3 },
        ],
      ],
      ['HAVING COUNT(r.id) = 0', [{ slug: 'stale-sequence' }]],
      ['FROM seq_instantly_campaigns', [{ count: 5 }]],
      ['FROM seq_instantly_campaign_daily_stats', [{ sent: 40, replied: 6 }]],
      ['/* overview: send_volume_30d */', [{ count: 25 }]],
    ])

    const res = await app.request('/api/internal/overview', { headers: accessHeaders }, env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      send_volume_7d: 10,
      send_volume_30d: 25,
      active_runs: 4,
      unsub_rate_7d: 0.2,
      rot_sequences: ['stale-sequence'],
      top_sequences: [
        { slug: 'camaudit-lead-magnet-tenant-checklist', product: 'camaudit', enrollments: 8 },
        { slug: 'floriva-web-fulfillment-intro', product: 'floriva-web', enrollments: 3 },
      ],
      warm_summary: { total_sent_7d: 10, avg_bounce_rate: 0.1 },
      cold_summary: { total_campaigns: 5, total_sent_7d: 40, reply_rate: 0.15 },
    })
  })

  it('scopes overview sequence enrollment joins by product as well as slug', async () => {
    const preparedSql: string[] = []
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      ['FROM seq_sequence_runs WHERE status = ?', [{ count: 0 }]],
      ['FROM seq_messages WHERE sent_at >= ?', [{ count: 0 }]],
      ['FROM seq_suppressions', [{ count: 0 }]],
      ['bounced_at IS NOT NULL', [{ count: 0 }]],
      ['JOIN seq_products p', []],
      ['HAVING COUNT(r.id) = 0', []],
      ['FROM seq_instantly_campaigns', [{ count: 0 }]],
      ['FROM seq_instantly_campaign_daily_stats', [{ sent: 0, replied: 0 }]],
      ['/* overview: send_volume_30d */', [{ count: 0 }]],
    ])
    const originalPrepare = env.DB.prepare
    env.DB.prepare = vi.fn((sql: string) => {
      preparedSql.push(sql)
      return (originalPrepare as (sql: string) => ReturnType<typeof originalPrepare>)(sql)
    })

    const res = await app.request('/api/internal/overview', { headers: accessHeaders }, env)

    expect(res.status).toBe(200)
    const topSequencesSql = preparedSql.find((sql) => sql.includes('ORDER BY enrollments DESC'))
    const rotSequencesSql = preparedSql.find((sql) => sql.includes('HAVING COUNT(r.id) = 0'))
    expect(topSequencesSql).toContain('r.product_id = s.product_id')
    expect(rotSequencesSql).toContain('r.product_id = s.product_id')
  })

  it('hides retired Instantly campaigns from the internal deliverability list', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../routes/internal/index.ts'),
      'utf8',
    )

    expect(source).toContain(".where(ne(instantly_campaigns.status, 'retired'))")
  })

  it('assigns Instantly campaign ownership through the internal deliverability API', async () => {
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('/* internal instantly campaign lookup */')) {
            return {
              id: '11111111-0000-0000-0000-000000000001',
              product_id: null,
              name: 'CAMAudit cold',
              status: 'active',
              created_at_instantly: null,
              synced_at: '2026-05-26T10:00:00.000Z',
            }
          }
          if (sql.includes('/* internal instantly campaign product lookup */')) {
            return { id: 'prod_camaudit', slug: 'camaudit', name: 'CAMAudit' }
          }
          if (sql.includes('/* internal instantly campaign updated row */')) {
            return {
              id: '11111111-0000-0000-0000-000000000001',
              product_id: 'prod_camaudit',
              name: 'CAMAudit cold',
              status: 'active',
              created_at_instantly: null,
              synced_at: '2026-05-26T10:00:00.000Z',
            }
          }
          return null
        }),
        run: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          return { meta: { changes: 1 } }
        }),
      }),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/deliverability/instantly-campaigns/11111111-0000-0000-0000-000000000001',
      {
        method: 'PATCH',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: 'prod_camaudit' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: '11111111-0000-0000-0000-000000000001',
      product_id: 'prod_camaudit',
      name: 'CAMAudit cold',
      status: 'active',
      created_at_instantly: null,
      synced_at: '2026-05-26T10:00:00.000Z',
    })
    expect(sqlCalls).toEqual([
      {
        sql: expect.stringContaining('UPDATE seq_instantly_campaigns'),
        binds: ['prod_camaudit', '11111111-0000-0000-0000-000000000001'],
      },
    ])
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'instantly_campaign.updated',
      'instantly_campaign',
      '11111111-0000-0000-0000-000000000001',
      expect.objectContaining({ product_id: null }),
      expect.objectContaining({ product_id: 'prod_camaudit' }),
    )
  })

  it('rejects Instantly campaign ownership assignment to unknown products', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('/* internal instantly campaign lookup */')) {
            return {
              id: '11111111-0000-0000-0000-000000000001',
              product_id: null,
              name: 'CAMAudit cold',
              status: 'active',
              created_at_instantly: null,
              synced_at: '2026-05-26T10:00:00.000Z',
            }
          }
          return null
        }),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/deliverability/instantly-campaigns/11111111-0000-0000-0000-000000000001',
      {
        method: 'PATCH',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: 'prod_missing' }),
      },
      env,
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Product not found' })
    expect(prepare).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE seq_instantly_campaigns'),
    )
  })

  it('builds the template catalog from active synced sequence definitions', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        'FROM seq_sequences s',
        [
          {
            sequence_slug: 'camaudit-demo',
            version: 2,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            definition: JSON.stringify({
              steps: [
                {
                  id: 'deliver',
                  template: 'lead-magnets/tenant-checklist-delivery',
                  subject: 'Checklist',
                },
                {
                  id: 'legacy',
                  template: 'legacy/camaudit/recovery-window',
                  subject: { a: 'Recovery A', b: 'Recovery B' },
                },
                {
                  id: 'repeat',
                  template: 'legacy/camaudit/recovery-window',
                  subject: 'Recovery follow-up',
                },
              ],
            }),
          },
          {
            sequence_slug: 'inactive-demo',
            version: 1,
            is_active: 0,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            definition: JSON.stringify({
              steps: [{ id: 'inactive', template: 'unused/template', subject: 'Unused' }],
            }),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/templates?product=camaudit&kind=legacy-camaudit',
      { headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        slug: 'legacy/camaudit/recovery-window',
        product_id: 'prod_camaudit',
        product_slug: 'camaudit',
        product_name: 'CAMAudit',
        kind: 'legacy-camaudit',
        renderable: true,
        preview_url:
          '/api/internal/templates/legacy%2Fcamaudit%2Frecovery-window/preview?product=camaudit&sequence=camaudit-demo',
        usage_count: 2,
        sequences: [
          {
            slug: 'camaudit-demo',
            version: 2,
            is_active: true,
            step_ids: ['legacy', 'repeat'],
            subjects: ['Recovery A', 'Recovery B', 'Recovery follow-up'],
          },
        ],
        source: { legacy_key: 'recovery-window' },
      },
    ])
  })

  it('does not mark missing template implementations as previewable', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        'FROM seq_sequences s',
        [
          {
            sequence_slug: 'broken-demo',
            version: 1,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            definition: JSON.stringify({
              steps: [{ id: 'missing', template: 'missing/template', subject: 'Missing template' }],
            }),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/templates?product=camaudit',
      { headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        slug: 'missing/template',
        product_id: 'prod_camaudit',
        product_slug: 'camaudit',
        product_name: 'CAMAudit',
        kind: 'react-email',
        renderable: false,
        preview_url: '',
        usage_count: 1,
        sequences: [
          {
            slug: 'broken-demo',
            version: 1,
            is_active: true,
            step_ids: ['missing'],
            subjects: ['Missing template'],
          },
        ],
        source: {},
      },
    ])
  })

  it('skips synced sequence definitions whose steps field is not an array', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        'FROM seq_sequences s',
        [
          {
            sequence_slug: 'malformed-demo',
            version: 1,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            definition: JSON.stringify({
              steps: { id: 'not-an-array', template: 'missing/template' },
            }),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/templates?product=camaudit',
      { headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(isRenderableTemplate).not.toHaveBeenCalled()
  })

  it('ignores malformed step entries in synced sequence definitions', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        'FROM seq_sequences s',
        [
          {
            sequence_slug: 'mixed-demo',
            version: 1,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            definition: JSON.stringify({
              steps: [
                null,
                'missing/template',
                { id: 'valid', template: 'missing/template', subject: 'Valid subject' },
              ],
            }),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/templates?product=camaudit',
      { headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        slug: 'missing/template',
        product_id: 'prod_camaudit',
        product_slug: 'camaudit',
        product_name: 'CAMAudit',
        kind: 'react-email',
        renderable: false,
        preview_url: '',
        usage_count: 1,
        sequences: [
          {
            slug: 'mixed-demo',
            version: 1,
            is_active: true,
            step_ids: ['valid'],
            subjects: ['Valid subject'],
          },
        ],
        source: {},
      },
    ])
  })

  it('returns contacts with product memberships and active sequence state', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const bind = vi.fn(() => ({
      all: vi.fn(async () => ({
        results: [
          {
            id: 'contact_1',
            email: 'tenant@example.com',
            first_name: 'Tessa',
            last_name: 'Tenant',
            properties: JSON.stringify({ plan: 'pro' }),
            created_at: '2026-05-19T10:00:00.000Z',
            updated_at: '2026-05-19T10:00:00.000Z',
            memberships_json: JSON.stringify([
              {
                product_id: 'prod_camaudit',
                product_slug: 'camaudit',
                product_name: 'CAMAudit',
                status: 'active',
                created_at: '2026-05-19T10:01:00.000Z',
                updated_at: '2026-05-19T10:01:00.000Z',
              },
            ]),
            active_run_json: JSON.stringify({
              id: 'run_1',
              sequence_slug: 'camaudit-lead-magnet-tenant-checklist',
              sequence_version: 2,
              status: 'running',
              current_step_index: 1,
              started_at: '2026-05-19T10:02:00.000Z',
              enrollment_source: 'lead_magnet',
            }),
            active_runs_json: JSON.stringify([
              {
                id: 'run_1',
                product_id: 'prod_camaudit',
                product_slug: 'camaudit',
                product_name: 'CAMAudit',
                sequence_slug: 'camaudit-lead-magnet-tenant-checklist',
                sequence_version: 2,
                status: 'running',
                current_step_index: 1,
                started_at: '2026-05-19T10:02:00.000Z',
                enrollment_source: 'lead_magnet',
              },
              {
                id: 'run_2',
                product_id: 'prod_floriva_web',
                product_slug: 'floriva-web',
                product_name: 'Floriva',
                sequence_slug: 'floriva-web-welcome',
                sequence_version: 1,
                status: 'running',
                current_step_index: 0,
                started_at: '2026-05-19T09:00:00.000Z',
                enrollment_source: 'api',
              },
            ]),
          },
        ],
      })),
    }))
    const prepare = vi.fn(() => ({ bind }))
    const env = baseEnv({ DB: { prepare } })

    const res = await app.request(
      '/api/internal/contacts?q=tenant%25_%5C&limit=125',
      { headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: 'contact_1',
        email: 'tenant@example.com',
        first_name: 'Tessa',
        last_name: 'Tenant',
        properties: { plan: 'pro' },
        created_at: '2026-05-19T10:00:00.000Z',
        updated_at: '2026-05-19T10:00:00.000Z',
        memberships: [
          {
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            status: 'active',
            created_at: '2026-05-19T10:01:00.000Z',
            updated_at: '2026-05-19T10:01:00.000Z',
          },
        ],
        active_run: {
          id: 'run_1',
          sequence_slug: 'camaudit-lead-magnet-tenant-checklist',
          sequence_version: 2,
          status: 'running',
          current_step_index: 1,
          started_at: '2026-05-19T10:02:00.000Z',
          enrollment_source: 'lead_magnet',
        },
        active_runs: [
          expect.objectContaining({ id: 'run_1', product_slug: 'camaudit' }),
          expect.objectContaining({ id: 'run_2', product_slug: 'floriva-web' }),
        ],
      },
    ])
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('/* internal contacts enriched list */'),
    )
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("ESCAPE '\\'"))
    // q binds the escaped LIKE pattern once each for email, first_name, and
    // last_name; the two nulls are the absent product-slug filter.
    expect(bind).toHaveBeenCalledWith(
      '%tenant\\%\\_\\\\%',
      '%tenant\\%\\_\\\\%',
      '%tenant\\%\\_\\\\%',
      '%tenant\\%\\_\\\\%',
      null,
      null,
      100,
      0,
    )
  })

  it('returns empty contact memberships and active run as stable defaults', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        '/* internal contacts enriched list */',
        [
          {
            id: 'contact_2',
            email: 'empty@example.com',
            first_name: null,
            last_name: null,
            properties: 'not-json',
            created_at: '2026-05-18T10:00:00.000Z',
            updated_at: '2026-05-18T10:00:00.000Z',
            memberships_json: null,
            active_run_json: null,
            active_runs_json: null,
          },
        ],
      ],
    ])

    const res = await app.request('/api/internal/contacts', { headers: accessHeaders }, env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: 'contact_2',
        email: 'empty@example.com',
        first_name: null,
        last_name: null,
        properties: null,
        created_at: '2026-05-18T10:00:00.000Z',
        updated_at: '2026-05-18T10:00:00.000Z',
        memberships: [],
        active_run: null,
        active_runs: [],
      },
    ])
  })

  it('returns dashboard contact detail with completed run history', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        'FROM seq_sequence_runs',
        [
          {
            id: 'run_done',
            contact_id: '33333333-0000-0000-0000-000000000003',
            sequence_slug: 'camaudit-welcome',
            sequence_version: 1,
            status: 'completed',
            current_step_index: 1,
            enrollment_source: 'api',
            started_at: '2026-05-18T10:02:00.000Z',
            completed_at: '2026-05-18T10:30:00.000Z',
            variant_assignment: '{"variant_id":"control"}',
          },
        ],
      ],
      [
        'FROM seq_steps',
        [
          {
            id: 'step_done',
            run_id: 'run_done',
            step_index: 0,
            template_slug: 'welcome',
            status: 'sent',
            scheduled_for: '2026-05-18T10:05:00.000Z',
            sent_at: '2026-05-18T10:06:00.000Z',
            message_id: 'msg_provider',
          },
        ],
      ],
      [
        'FROM seq_messages',
        [
          {
            id: 'message_done',
            step_id: 'step_done',
            contact_id: '33333333-0000-0000-0000-000000000003',
            product_id: 'prod_camaudit',
            resend_message_id: 'msg_provider',
            subject: 'Welcome aboard',
            from_email: 'founder@camaudit.io',
            sent_at: '2026-05-18T10:06:00.000Z',
          },
        ],
      ],
      [
        'message_id IN',
        [
          {
            id: 'event_opened',
            provider: 'resend',
            message_id: 'msg_provider',
            type: 'email.opened',
            payload: '{"email_id":"msg_provider"}',
            received_at: '2026-05-18T10:08:00.000Z',
          },
        ],
      ],
      [
        "provider = 'internal'",
        [
          {
            id: 'event_reply',
            provider: 'internal',
            message_id: null,
            type: 'reply_received',
            payload: '{"email":"history@example.com","product":"camaudit"}',
            received_at: '2026-05-18T10:20:00.000Z',
          },
        ],
      ],
      [
        '/* internal contact detail */',
        [
          {
            id: '33333333-0000-0000-0000-000000000003',
            email: 'history@example.com',
            first_name: 'Hannah',
            last_name: 'History',
            properties: JSON.stringify({ plan: 'team' }),
            created_at: '2026-05-18T10:00:00.000Z',
            updated_at: '2026-05-18T10:00:00.000Z',
            memberships_json: JSON.stringify([
              {
                product_id: 'prod_camaudit',
                product_slug: 'camaudit',
                product_name: 'CAMAudit',
                status: 'active',
                created_at: '2026-05-18T10:01:00.000Z',
                updated_at: '2026-05-18T10:01:00.000Z',
              },
            ]),
            active_run_json: null,
            active_runs_json: JSON.stringify([
              {
                id: 'run_camaudit',
                product_id: 'prod_camaudit',
                product_slug: 'camaudit',
                product_name: 'CAMAudit',
                sequence_slug: 'camaudit-nurture',
                sequence_version: 3,
                status: 'running',
                current_step_index: 2,
                started_at: '2026-05-18T11:00:00.000Z',
                enrollment_source: 'api',
              },
              {
                id: 'run_floriva-web',
                product_id: 'prod_floriva_web',
                product_slug: 'floriva-web',
                product_name: 'Floriva',
                sequence_slug: 'floriva-web-onboarding',
                sequence_version: 1,
                status: 'running',
                current_step_index: 0,
                started_at: '2026-05-18T10:45:00.000Z',
                enrollment_source: 'lead_magnet',
              },
            ]),
          },
        ],
      ],
    ])

    const res = await app.request(
      '/api/internal/contacts/33333333-0000-0000-0000-000000000003',
      { headers: accessHeaders },
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      id: '33333333-0000-0000-0000-000000000003',
      email: 'history@example.com',
      active_run: null,
      active_runs: [
        expect.objectContaining({ id: 'run_camaudit', product_slug: 'camaudit' }),
        expect.objectContaining({ id: 'run_floriva-web', product_slug: 'floriva-web' }),
      ],
      runs: [
        expect.objectContaining({
          id: 'run_done',
          status: 'completed',
          sequence_slug: 'camaudit-welcome',
          variant_assignment: { variant_id: 'control' },
          steps: [
            expect.objectContaining({
              id: 'step_done',
              message: expect.objectContaining({ subject: 'Welcome aboard' }),
              events: [
                expect.objectContaining({
                  type: 'email.opened',
                  payload: { email_id: 'msg_provider' },
                }),
              ],
            }),
          ],
        }),
      ],
      messages: [expect.objectContaining({ id: 'message_done', subject: 'Welcome aboard' })],
      events: [
        expect.objectContaining({ id: 'event_opened', type: 'email.opened' }),
        expect.objectContaining({ id: 'event_reply', type: 'reply_received' }),
      ],
    })
    expect((body.timeline as Array<{ kind: string }>).map((entry) => entry.kind)).toEqual([
      'run.started',
      'step.sent',
      'message.sent',
      'event.email.opened',
      'event.reply_received',
      'run.completed',
    ])
  })

  it('filters suppression lists by scope before applying the dashboard cap', async () => {
    suppressionsSelectRows = [
      {
        id: 'supp_global',
        email: 'global@example.com',
        scope: 'global',
        product_id: null,
        reason: 'manual',
        source: 'manual',
        created_at: '2026-05-20T10:00:00.000Z',
      },
      {
        id: 'supp_product',
        email: 'product@example.com',
        scope: 'product',
        product_id: 'prod_camaudit',
        reason: 'manual',
        source: 'manual',
        created_at: '2026-05-20T09:00:00.000Z',
      },
    ]
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions?scope=product',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([suppressionsSelectRows[1]])
    expect(dbSelectWhere).toHaveBeenCalled()
    expect(dbSelectLimit).toHaveBeenCalledWith(100)
  })

  it('rejects invalid suppression list scopes before querying D1', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions?scope=all',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'scope must be global or product' })
    expect(dbSelectLimit).not.toHaveBeenCalled()
  })

  it('returns audit entries with explicit next-page metadata from a one-row lookahead', async () => {
    auditSelectRows = Array.from({ length: 51 }, (_, index) => ({
      id: `audit_${index + 1}`,
      actor: 'angel@example.com',
      action: 'updated',
      target_type: 'sequence',
      target_id: `seq_${index + 1}`,
      before: null,
      after: null,
      at: `2026-05-20T10:${String(index).padStart(2, '0')}:00.000Z`,
    }))
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/audit?page=1',
      { headers: accessHeaders },
      baseEnv(),
    )
    const body = (await res.json()) as { entries: unknown[]; has_next: boolean }

    expect(res.status).toBe(200)
    expect(body.entries).toHaveLength(50)
    expect(body.entries[0]).toEqual(auditSelectRows[0])
    expect(body.has_next).toBe(true)
    expect(dbSelectLimit).toHaveBeenCalledWith(51)
    expect(dbSelectOffset).toHaveBeenCalledWith(0)
  })

  it('does not report a next audit page when the lookahead row is absent', async () => {
    auditSelectRows = Array.from({ length: 50 }, (_, index) => ({
      id: `audit_${index + 1}`,
      actor: 'angel@example.com',
      action: 'updated',
      target_type: 'sequence',
      target_id: null,
      before: null,
      after: null,
      at: `2026-05-20T10:${String(index).padStart(2, '0')}:00.000Z`,
    }))
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/audit?page=1',
      { headers: accessHeaders },
      baseEnv(),
    )
    const body = (await res.json()) as { entries: unknown[]; has_next: boolean }

    expect(res.status).toBe(200)
    expect(body.entries).toHaveLength(50)
    expect(body.has_next).toBe(false)
  })

  it('rejects product-scoped manual suppressions without a product id', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'tenant@example.com', scope: 'product' }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'product_id is required for product-scoped suppressions',
    })
    expect(dbInsertValues).not.toHaveBeenCalled()
    expect(addSuppression).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('rejects product-scoped manual suppressions for unknown products', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tenant@example.com',
          scope: 'product',
          product_id: 'prod_missing',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'product not found' })
    expect(addSuppression).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it.each([
    ['non-string email', { email: 42, scope: 'global' }],
    ['malformed email', { email: 'not-an-email', scope: 'global' }],
    ['JSON null body', null],
  ])('rejects invalid dashboard manual suppression payloads before side effects: %s', async (_caseName, body) => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'email must be a valid email address' })
    expect(addSuppression).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('audits dashboard-created manual suppressions', async () => {
    productSelectRows = [{ id: 'prod_camaudit' }]
    addSuppression.mockResolvedValueOnce({ created: true, id: 'supp_1' })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Tenant@Example.com ',
          scope: 'product',
          product_id: 'prod_camaudit',
          reason: 'requested removal',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(addSuppression).toHaveBeenCalledWith(
      expect.any(Object),
      'tenant@example.com',
      'product',
      'prod_camaudit',
      'requested removal',
      'manual',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.any(Object),
      'operator@example.com',
      'suppression.created',
      'suppression',
      'supp_1',
      null,
      {
        email: 'tenant@example.com',
        scope: 'product',
        product_id: 'prod_camaudit',
        reason: 'requested removal',
        source: 'manual',
      },
    )
  })

  it('cancels active runs after dashboard-created product suppressions', async () => {
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [{ id: 'run_active' }]
    addSuppression.mockResolvedValueOnce({ created: true, id: 'supp_1' })
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Tenant@Example.com ',
          scope: 'product',
          product_id: 'prod_camaudit',
          reason: 'requested removal',
        }),
      },
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }),
    )

    expect(res.status).toBe(201)
    expect(doFetch).toHaveBeenCalledOnce()
    expect(new URL(doFetch.mock.calls[0][0].url).pathname).toBe('/cancel')
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: 'suppression:requested removal',
    })
  })

  it('audits duplicate dashboard manual suppressions as requests instead of creations', async () => {
    addSuppression.mockResolvedValueOnce({ created: false, id: 'supp_1' })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/suppressions',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tenant@example.com',
          scope: 'global',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(audit).toHaveBeenCalledWith(
      expect.any(Object),
      'operator@example.com',
      'suppression.requested',
      'suppression',
      'supp_1',
      null,
      {
        email: 'tenant@example.com',
        scope: 'global',
        product_id: null,
        reason: 'manual:operator@example.com',
        source: 'manual',
      },
    )
  })

  it('returns lead magnets with product labels and asset readiness status', async () => {
    const florivaBucket = {
      head: vi.fn(async (key: string) =>
        key === 'lead-magnets/present.pdf'
          ? { size: 42, uploaded: new Date('2026-05-19T10:00:00.000Z') }
          : null,
      ),
    }
    const sequencerBucket = {
      head: vi.fn(async (key: string) => {
        if (key === 'legacy.pdf') return { size: 7, uploaded: new Date('2026-05-19T10:00:00.000Z') }
        if (key === 'throws.pdf') throw new Error('r2 unavailable')
        return null
      }),
    }
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        '/* internal lead magnets list */',
        [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'tenant-checklist',
            name: 'Tenant Checklist',
            asset_r2_bucket: 'floriva-lead-magnets',
            asset_r2_key: 'lead-magnets/present.pdf',
            fulfillment_sequence_slug: 'camaudit-fulfillment',
            conversion_event_name: 'lead_magnet_downloaded',
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
          {
            id: 'lm_missing',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'missing-checklist',
            name: 'Missing Checklist',
            asset_r2_bucket: 'floriva-lead-magnets',
            asset_r2_key: 'lead-magnets/missing.pdf',
            fulfillment_sequence_slug: null,
            conversion_event_name: null,
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
          {
            id: 'lm_unbound',
            product_id: 'prod_grantpipe',
            product_slug: 'grantpipe',
            product_name: 'GrantPipe',
            slug: 'lease-checklist',
            name: 'Lease Checklist',
            asset_r2_bucket: 'grantpipe-documents',
            asset_r2_key: 'lease.pdf',
            fulfillment_sequence_slug: null,
            conversion_event_name: null,
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
          {
            id: 'lm_unconfigured',
            product_id: 'prod_grantpipe',
            product_slug: 'grantpipe',
            product_name: 'GrantPipe',
            slug: 'dynamic-template',
            name: 'Dynamic Template',
            asset_r2_bucket: null,
            asset_r2_key: null,
            fulfillment_sequence_slug: null,
            conversion_event_name: null,
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
          {
            id: 'lm_default_bucket',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'legacy-asset',
            name: 'Legacy Asset',
            asset_r2_bucket: null,
            asset_r2_key: 'legacy.pdf',
            fulfillment_sequence_slug: null,
            conversion_event_name: null,
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
          {
            id: 'lm_probe_error',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'probe-error',
            name: 'Probe Error',
            asset_r2_bucket: null,
            asset_r2_key: 'throws.pdf',
            fulfillment_sequence_slug: null,
            conversion_event_name: null,
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
        ],
      ],
    ])
    Object.assign(env, { ASSETS_BUCKET: sequencerBucket, FLORIVA_LEAD_MAGNETS: florivaBucket })

    const res = await app.request('/api/internal/lead-magnets', { headers: accessHeaders }, env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      expect.objectContaining({
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        product_slug: 'camaudit',
        product_name: 'CAMAudit',
        asset_r2_bucket: 'floriva-lead-magnets',
        asset_r2_key: 'lead-magnets/present.pdf',
        asset_status: 'available',
        asset_size: 42,
      }),
      expect.objectContaining({
        id: 'lm_missing',
        asset_status: 'missing',
        asset_size: null,
      }),
      expect.objectContaining({
        id: 'lm_unbound',
        product_slug: 'grantpipe',
        asset_status: 'bucket_unbound',
        asset_size: null,
      }),
      expect.objectContaining({
        id: 'lm_unconfigured',
        product_slug: 'grantpipe',
        asset_status: 'not_configured',
        asset_size: null,
      }),
      expect.objectContaining({
        id: 'lm_default_bucket',
        asset_r2_bucket: null,
        effective_asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'legacy.pdf',
        asset_status: 'available',
        asset_size: 7,
      }),
      expect.objectContaining({
        id: 'lm_probe_error',
        effective_asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'throws.pdf',
        asset_status: 'unknown',
        asset_size: null,
      }),
    ])
    expect(florivaBucket.head).toHaveBeenCalledWith('lead-magnets/present.pdf')
    expect(florivaBucket.head).toHaveBeenCalledWith('lead-magnets/missing.pdf')
    expect(sequencerBucket.head).toHaveBeenCalledWith('legacy.pdf')
    expect(sequencerBucket.head).toHaveBeenCalledWith('throws.pdf')
  })

  it('creates a lead magnet with same-product fulfillment validation and audit logging', async () => {
    const randomUUID = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('lm_new' as `${string}-${string}-${string}-${string}-${string}`)
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const rowsForSql = (sql: string) => {
      if (sql.includes('/* internal lead magnet product lookup */')) {
        return [{ id: 'prod_camaudit', slug: 'camaudit', name: 'CAMAudit' }]
      }
      if (sql.includes('/* internal lead magnet fulfillment sequence lookup */')) {
        return [{ slug: 'camaudit-fulfillment' }]
      }
      if (sql.includes('/* internal lead magnet created row */')) {
        return [
          {
            id: 'lm_new',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'tenant-checklist',
            name: 'Tenant Checklist',
            asset_r2_bucket: 'floriva-lead-magnets',
            asset_r2_key: 'lead-magnets/tenant.pdf',
            fulfillment_sequence_slug: 'camaudit-fulfillment',
            conversion_event_name: 'lead_magnet_downloaded',
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
        ]
      }
      return []
    }
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        all: vi.fn(async () => ({ results: rowsForSql(sql) })),
        first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
        run: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          return { meta: { changes: 1 } }
        }),
      }),
      all: vi.fn(async () => ({ results: rowsForSql(sql) })),
      first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
    }))
    const env = baseEnv({
      DB: { prepare },
      FLORIVA_LEAD_MAGNETS: {
        head: vi.fn(async () => ({ size: 123, uploaded: new Date('2026-05-19T10:00:00.000Z') })),
      },
    })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          slug: ' tenant-checklist ',
          name: ' Tenant Checklist ',
          asset_r2_bucket: 'floriva-lead-magnets',
          asset_r2_key: 'lead-magnets/tenant.pdf',
          fulfillment_sequence_slug: 'camaudit-fulfillment',
          conversion_event_name: 'lead_magnet_downloaded',
          active: true,
        }),
      },
      env,
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(
      expect.objectContaining({
        id: 'lm_new',
        product_id: 'prod_camaudit',
        product_slug: 'camaudit',
        slug: 'tenant-checklist',
        name: 'Tenant Checklist',
        asset_r2_bucket: 'floriva-lead-magnets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
        asset_status: 'available',
        asset_size: 123,
        fulfillment_sequence_slug: 'camaudit-fulfillment',
        conversion_event_name: 'lead_magnet_downloaded',
        active: true,
      }),
    )
    expect(sqlCalls).toEqual([
      {
        sql: expect.stringContaining('INSERT INTO seq_lead_magnets'),
        binds: [
          'lm_new',
          'prod_camaudit',
          'tenant-checklist',
          'Tenant Checklist',
          'floriva-lead-magnets',
          'lead-magnets/tenant.pdf',
          'camaudit-fulfillment',
          'lead_magnet_downloaded',
          1,
        ],
      },
    ])
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'lead_magnet.created',
      'lead_magnet',
      'lm_new',
      null,
      expect.objectContaining({
        product_id: 'prod_camaudit',
        slug: 'tenant-checklist',
        asset_r2_key: 'lead-magnets/tenant.pdf',
        active: true,
      }),
    )
    randomUUID.mockRestore()
  })

  it('rejects lead magnet creation for an unknown product', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () =>
          sql.includes('/* internal lead magnet product lookup */') ? null : { slug: 'ignored' },
        ),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_missing',
          slug: 'tenant-checklist',
          name: 'Tenant Checklist',
        }),
      },
      env,
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Product not found' })
    expect(prepare).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO seq_lead_magnets'),
    )
  })

  it('rejects lead magnet creation when fulfillment sequence is not active for the same product', async () => {
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        first: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          if (sql.includes('/* internal lead magnet product lookup */')) {
            return { id: 'prod_camaudit', slug: 'camaudit', name: 'CAMAudit' }
          }
          return null
        }),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      }),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          slug: 'tenant-checklist',
          name: 'Tenant Checklist',
          fulfillment_sequence_slug: 'floriva-web-fulfillment',
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Fulfillment sequence not found for lead magnet product',
    })
    expect(sqlCalls).toEqual(
      expect.arrayContaining([
        {
          sql: expect.stringContaining('/* internal lead magnet fulfillment sequence lookup */'),
          binds: ['floriva-web-fulfillment', 'prod_camaudit'],
        },
      ]),
    )
  })

  it('returns conflict when creating a lead magnet with a duplicate slug', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('/* internal lead magnet product lookup */')) {
            return { id: 'prod_camaudit', slug: 'camaudit', name: 'CAMAudit' }
          }
          return null
        }),
        run: vi.fn(async () => {
          throw new Error('UNIQUE constraint failed: seq_lead_magnets.slug')
        }),
      })),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          slug: 'tenant-checklist',
          name: 'Tenant Checklist',
        }),
      },
      env,
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Lead magnet slug is already in use' })
    expect(audit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'lead_magnet.created',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it('validates required and typed lead magnet creation fields', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = baseEnv()

    const missingProduct = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'tenant-checklist', name: 'Tenant Checklist' }),
      },
      env,
    )
    const invalidActive = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          slug: 'tenant-checklist',
          name: 'Tenant Checklist',
          active: 'yes',
        }),
      },
      env,
    )
    const invalidBucket = await app.request(
      '/api/internal/lead-magnets',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          slug: 'tenant-checklist',
          name: 'Tenant Checklist',
          asset_r2_bucket: 'unknown-lead-magnets',
        }),
      },
      env,
    )

    expect(missingProduct.status).toBe(400)
    expect(await missingProduct.json()).toEqual({ error: 'product_id is required' })
    expect(invalidActive.status).toBe(400)
    expect(await invalidActive.json()).toEqual({ error: 'active must be a boolean' })
    expect(invalidBucket.status).toBe(400)
    expect(await invalidBucket.json()).toEqual({ error: 'asset_r2_bucket is not supported' })
  })

  it('scopes template catalog previews by product and sequence when template slugs repeat', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        'FROM seq_sequences s',
        [
          {
            sequence_slug: 'camaudit-demo',
            version: 1,
            is_active: 1,
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            definition: JSON.stringify({
              steps: [
                { id: 'welcome', template: 'onboarding/welcome', subject: 'CAMAudit welcome' },
              ],
            }),
          },
          {
            sequence_slug: 'grantpipe-demo',
            version: 1,
            is_active: 1,
            product_id: 'prod_grantpipe',
            product_slug: 'grantpipe',
            product_name: 'GrantPipe',
            definition: JSON.stringify({
              steps: [
                { id: 'welcome', template: 'onboarding/welcome', subject: 'GrantPipe welcome' },
              ],
            }),
          },
        ],
      ],
    ])

    const res = await app.request('/api/internal/templates', { headers: accessHeaders }, env)

    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<{ product_slug: string; preview_url: string }>
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_slug: 'camaudit',
          preview_url:
            '/api/internal/templates/onboarding%2Fwelcome/preview?product=camaudit&sequence=camaudit-demo',
        }),
        expect.objectContaining({
          product_slug: 'grantpipe',
          preview_url:
            '/api/internal/templates/onboarding%2Fwelcome/preview?product=grantpipe&sequence=grantpipe-demo',
        }),
      ]),
    )
    expect(new Set(rows.map((row) => row.preview_url)).size).toBe(rows.length)
  })

  it('updates lead magnet asset and fulfillment settings with validation and audit logging', async () => {
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const rowsForSql = (sql: string) => {
      if (sql.includes('/* internal lead magnet lookup */')) {
        return [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'tenant-checklist',
            name: 'Tenant Checklist',
            asset_r2_bucket: null,
            asset_r2_key: 'old.pdf',
            fulfillment_sequence_slug: null,
            conversion_event_name: null,
            active: 1,
            created_at: '2026-05-19T10:00:00.000Z',
          },
        ]
      }
      if (sql.includes('/* internal lead magnet fulfillment sequence lookup */')) {
        return [{ slug: 'camaudit-fulfillment' }]
      }
      if (sql.includes('/* internal lead magnet updated row */')) {
        return [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            slug: 'tenant-checklist',
            name: 'Tenant Checklist',
            asset_r2_bucket: 'camaudit',
            asset_r2_key: 'new.pdf',
            fulfillment_sequence_slug: 'camaudit-fulfillment',
            conversion_event_name: 'lead_magnet_downloaded',
            active: 0,
            created_at: '2026-05-19T10:00:00.000Z',
          },
        ]
      }
      return []
    }
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        all: vi.fn(async () => ({ results: rowsForSql(sql) })),
        first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
        run: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          return { meta: { changes: 1 } }
        }),
      }),
      all: vi.fn(async () => ({ results: rowsForSql(sql) })),
      first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/lead-magnets/aaaaaaaa-0000-0000-0000-000000000001',
      {
        method: 'PATCH',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_r2_bucket: 'camaudit',
          asset_r2_key: 'new.pdf',
          fulfillment_sequence_slug: 'camaudit-fulfillment',
          conversion_event_name: 'lead_magnet_downloaded',
          active: false,
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(
      expect.objectContaining({
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        asset_r2_bucket: 'camaudit',
        asset_r2_key: 'new.pdf',
        fulfillment_sequence_slug: 'camaudit-fulfillment',
        conversion_event_name: 'lead_magnet_downloaded',
        active: false,
      }),
    )
    expect(sqlCalls).toEqual([
      {
        sql: expect.stringContaining('UPDATE seq_lead_magnets'),
        binds: [
          'camaudit',
          'new.pdf',
          'camaudit-fulfillment',
          'lead_magnet_downloaded',
          0,
          'aaaaaaaa-0000-0000-0000-000000000001',
        ],
      },
    ])
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'lead_magnet.updated',
      'lead_magnet',
      'aaaaaaaa-0000-0000-0000-000000000001',
      expect.objectContaining({ asset_r2_key: 'old.pdf', active: true }),
      expect.objectContaining({ asset_r2_key: 'new.pdf', active: false }),
    )
  })

  it('rejects lead magnet asset updates for unsupported buckets before writing', async () => {
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        first: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          if (sql.includes('/* internal lead magnet lookup */')) {
            return {
              id: 'aaaaaaaa-0000-0000-0000-000000000001',
              product_id: 'prod_camaudit',
              product_slug: 'camaudit',
              product_name: 'CAMAudit',
              slug: 'tenant-checklist',
              name: 'Tenant Checklist',
              asset_r2_bucket: null,
              asset_r2_key: 'old.pdf',
              fulfillment_sequence_slug: null,
              conversion_event_name: null,
              active: 1,
              created_at: '2026-05-19T10:00:00.000Z',
            }
          }
          return null
        }),
        run: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          return { meta: { changes: 1 } }
        }),
      }),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/lead-magnets/aaaaaaaa-0000-0000-0000-000000000001',
      {
        method: 'PATCH',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_r2_bucket: 'unknown-lead-magnets' }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'asset_r2_bucket is not supported' })
    expect(sqlCalls.some((call) => call.sql.includes('UPDATE seq_lead_magnets'))).toBe(false)
    expect(audit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'lead_magnet.updated',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it('returns product API token mappings with active and revoked state', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)
    const env = envWithOverviewRows([
      [
        '/* internal api tokens list */',
        [
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000001',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            label: 'camaudit-service-token',
            access_service_token_id: '11111111111111111111111111111111.access',
            created_at: '2026-05-19T10:00:00.000Z',
            revoked_at: null,
          },
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000002',
            product_id: 'prod_floriva_web',
            product_slug: 'floriva-web',
            product_name: 'Floriva',
            label: 'old-floriva-web-token',
            access_service_token_id: '22222222222222222222222222222222.access',
            created_at: '2026-05-18T10:00:00.000Z',
            revoked_at: '2026-05-19T11:00:00.000Z',
          },
        ],
      ],
    ])

    const res = await app.request('/api/internal/api-tokens', { headers: accessHeaders }, env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: 'bbbbbbbb-0000-0000-0000-000000000001',
        product_id: 'prod_camaudit',
        product_slug: 'camaudit',
        product_name: 'CAMAudit',
        label: 'camaudit-service-token',
        access_service_token_id: '11111111111111111111111111111111.access',
        created_at: '2026-05-19T10:00:00.000Z',
        revoked_at: null,
        active: true,
      },
      {
        id: 'bbbbbbbb-0000-0000-0000-000000000002',
        product_id: 'prod_floriva_web',
        product_slug: 'floriva-web',
        product_name: 'Floriva',
        label: 'old-floriva-web-token',
        access_service_token_id: '22222222222222222222222222222222.access',
        created_at: '2026-05-18T10:00:00.000Z',
        revoked_at: '2026-05-19T11:00:00.000Z',
        active: false,
      },
    ])
  })

  it('rejects malformed product API token mappings before auditing', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/api-tokens',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          access_service_token_id: 'paste-client-id-here',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'access_service_token_id must be a Cloudflare Access client id ending in .access',
    })
    expect(audit).not.toHaveBeenCalled()
  })

  it('rejects non-string product API token mapping fields before auditing', async () => {
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/api-tokens',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          access_service_token_id: 123,
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'access_service_token_id must be a Cloudflare Access client id ending in .access',
    })
    expect(audit).not.toHaveBeenCalled()
  })

  it('creates product API token mappings with a default label and audit entry', async () => {
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const rowsForSql = (sql: string, binds: unknown[] = []) => {
      if (sql.includes('/* internal api token product lookup */')) {
        return [{ id: 'prod_camaudit', slug: 'camaudit', name: 'CAMAudit' }]
      }
      if (sql.includes('/* internal api token created row */')) {
        return [
          {
            id: binds[0],
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            label: 'camaudit-service-token',
            access_service_token_id: '11111111111111111111111111111111.access',
            created_at: '2026-05-19T10:00:00.000Z',
            revoked_at: null,
          },
        ]
      }
      return []
    }
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        all: vi.fn(async () => ({ results: rowsForSql(sql, binds) })),
        first: vi.fn(async () => rowsForSql(sql, binds)[0] ?? null),
        run: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          return {}
        }),
      }),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/api-tokens',
      {
        method: 'POST',
        headers: { ...accessHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: 'prod_camaudit',
          access_service_token_id: '11111111111111111111111111111111.access',
        }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      ok: true
      token: { id: string }
    }
    expect(body).toEqual({
      ok: true,
      token: {
        id: expect.any(String),
        product_id: 'prod_camaudit',
        product_slug: 'camaudit',
        product_name: 'CAMAudit',
        label: 'camaudit-service-token',
        access_service_token_id: '11111111111111111111111111111111.access',
        created_at: '2026-05-19T10:00:00.000Z',
        revoked_at: null,
        active: true,
      },
    })
    expect(sqlCalls.some((call) => call.sql.includes('INSERT INTO seq_api_tokens'))).toBe(true)
    expect(sqlCalls.find((call) => call.sql.includes('INSERT INTO seq_api_tokens'))?.binds).toEqual(
      [
        body.token.id,
        'prod_camaudit',
        'camaudit-service-token',
        '11111111111111111111111111111111.access',
      ],
    )
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'api_token.created',
      'api_token',
      body.token.id,
      null,
      {
        product_id: 'prod_camaudit',
        label: 'camaudit-service-token',
        access_service_token_id: '11111111111111111111111111111111.access',
      },
    )
  })

  it('soft-revokes active product API token mappings with an audit entry', async () => {
    const sqlCalls: Array<{ sql: string; binds: unknown[] }> = []
    const rowsForSql = (sql: string) => {
      if (sql.includes('/* internal api token revoke lookup */')) {
        return [
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000001',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            label: 'camaudit-service-token',
            access_service_token_id: '11111111111111111111111111111111.access',
            created_at: '2026-05-19T10:00:00.000Z',
            revoked_at: null,
          },
        ]
      }
      return []
    }
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        all: vi.fn(async () => ({ results: rowsForSql(sql) })),
        first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
        run: vi.fn(async () => {
          sqlCalls.push({ sql, binds })
          return {}
        }),
      }),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/api-tokens/bbbbbbbb-0000-0000-0000-000000000001/revoke',
      {
        method: 'POST',
        headers: accessHeaders,
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sqlCalls).toEqual([
      {
        sql: expect.stringContaining('UPDATE seq_api_tokens SET revoked_at = ?'),
        binds: [expect.any(String), 'bbbbbbbb-0000-0000-0000-000000000001'],
      },
    ])
    const revokedAt = sqlCalls[0].binds[0]
    expect(audit).toHaveBeenCalledWith(
      env,
      'operator@example.com',
      'api_token.revoked',
      'api_token',
      'bbbbbbbb-0000-0000-0000-000000000001',
      {
        product_id: 'prod_camaudit',
        label: 'camaudit-service-token',
        access_service_token_id: '11111111111111111111111111111111.access',
      },
      expect.objectContaining({ revoked_at: revokedAt }),
    )
  })

  it('does not audit product API token revokes when the conditional update changes no rows', async () => {
    const rowsForSql = (sql: string) => {
      if (sql.includes('/* internal api token revoke lookup */')) {
        return [
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000001',
            product_id: 'prod_camaudit',
            product_slug: 'camaudit',
            product_name: 'CAMAudit',
            label: 'camaudit-service-token',
            access_service_token_id: '11111111111111111111111111111111.access',
            created_at: '2026-05-19T10:00:00.000Z',
            revoked_at: null,
          },
        ]
      }
      return []
    }
    const prepare = vi.fn((sql: string) => ({
      bind: () => ({
        all: vi.fn(async () => ({ results: rowsForSql(sql) })),
        first: vi.fn(async () => rowsForSql(sql)[0] ?? null),
        run: vi.fn(async () => ({ meta: { changes: 0, rows_written: 0 } })),
      }),
    }))
    const env = baseEnv({ DB: { prepare } })
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/api-tokens/bbbbbbbb-0000-0000-0000-000000000001/revoke',
      {
        method: 'POST',
        headers: accessHeaders,
      },
      env,
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Active API token mapping not found' })
    expect(audit).not.toHaveBeenCalled()
  })

  it('returns a clear 404 for missing templates', async () => {
    renderEmailForTemplate.mockRejectedValue(
      Object.assign(new Error('Template not found: missing/template'), {
        name: 'TemplateNotFoundError',
        templateSlug: 'missing/template',
      }),
    )
    const { internalRoute } = await import('../routes/internal/index')
    const app = new Hono()
    app.route('/api/internal', internalRoute)

    const res = await app.request(
      '/api/internal/templates/missing%2Ftemplate/preview',
      { headers: accessHeaders },
      baseEnv(),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Template not found', slug: 'missing/template' })
  })
})

describe('Instantly webhook cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbUpdateWhereResult = null
  })

  it('normalizes non-string Resend event types before queueing', async () => {
    const secret = `whsec_${Buffer.from('webhook-secret').toString('base64')}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const msgId = 'msg_1'
    const body = JSON.stringify({
      type: { nested: 'event' },
      data: { email_id: { nested: 'email_1' } },
    })
    const signature = await signResendWebhook(body, timestamp, msgId, secret)
    const env = baseEnv({ RESEND_WEBHOOK_SECRET: secret })
    const { resendWebhookRoute } = await import('../webhooks/resend')
    const app = new Hono()
    app.route('/webhooks/resend', resendWebhookRoute)

    const res = await app.request(
      '/webhooks/resend',
      {
        method: 'POST',
        headers: {
          'svix-signature': signature,
          'svix-timestamp': timestamp,
          'svix-id': msgId,
        },
        body,
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(env.EVENTS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'resend',
        event_id: msgId,
        event_type: 'unknown',
        message_id: null,
      }),
    )
  })

  it('rejects signed Resend JSON payloads that are not objects', async () => {
    const secret = `whsec_${Buffer.from('webhook-secret').toString('base64')}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const msgId = 'msg_1'
    const body = 'null'
    const signature = await signResendWebhook(body, timestamp, msgId, secret)
    const env = baseEnv({ RESEND_WEBHOOK_SECRET: secret })
    const { resendWebhookRoute } = await import('../webhooks/resend')
    const app = new Hono()
    app.route('/webhooks/resend', resendWebhookRoute)

    const res = await app.request(
      '/webhooks/resend',
      {
        method: 'POST',
        headers: {
          'svix-signature': signature,
          'svix-timestamp': timestamp,
          'svix-id': msgId,
        },
        body,
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid payload' })
    expect(env.EVENTS_QUEUE.send).not.toHaveBeenCalled()
  })

  it('rejects signed Resend webhooks with malformed timestamp headers', async () => {
    const secret = `whsec_${Buffer.from('webhook-secret').toString('base64')}`
    const timestamp = `${Math.floor(Date.now() / 1000)}junk`
    const msgId = 'msg_1'
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email_1' } })
    const signature = await signResendWebhook(body, timestamp, msgId, secret)
    const env = baseEnv({ RESEND_WEBHOOK_SECRET: secret })
    const { resendWebhookRoute } = await import('../webhooks/resend')
    const app = new Hono()
    app.route('/webhooks/resend', resendWebhookRoute)

    const res = await app.request(
      '/webhooks/resend',
      {
        method: 'POST',
        headers: {
          'svix-signature': signature,
          'svix-timestamp': timestamp,
          'svix-id': msgId,
        },
        body,
      },
      env,
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Timestamp out of range' })
    expect(env.EVENTS_QUEUE.send).not.toHaveBeenCalled()
  })

  it('verifies the secret, tracks a metric, and enqueues one normalized event', async () => {
    const env = baseEnv({ INSTANTLY_WEBHOOK_SECRET: 'secret' })
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    const app = new Hono()
    app.route('/webhooks/instantly', instantlyWebhookRoute)

    const res = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-instantly-webhook-secret': 'secret',
        },
        body: JSON.stringify({ event_type: 'reply_received', id: 'evt_1', lead_id: 'lead_1' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledOnce()
    expect(env.EVENTS_QUEUE.send).toHaveBeenCalledOnce()
    expect(env.EVENTS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'instantly',
        event_type: 'reply_received',
        message_id: 'evt_1',
        payload: { event_type: 'reply_received', id: 'evt_1', lead_id: 'lead_1' },
      }),
    )
    expect(dbInsertValues).not.toHaveBeenCalled()
  })

  it('derives a stable event id for documented Instantly payloads without provider ids', async () => {
    const env = baseEnv({ INSTANTLY_WEBHOOK_SECRET: 'secret' })
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    const app = new Hono()
    app.route('/webhooks/instantly', instantlyWebhookRoute)
    const payload = {
      timestamp: '2026-05-26T10:00:00.000Z',
      event_type: 'reply_received',
      campaign_id: '11111111-0000-0000-0000-000000000001',
      campaign_name: 'CAMAudit cold',
      lead_email: 'User@Example.com',
    }

    const res = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: { 'x-instantly-webhook-secret': 'secret' },
        body: JSON.stringify(payload),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(env.EVENTS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'instantly',
        event_id:
          'instantly:reply_received:11111111-0000-0000-0000-000000000001:user@example.com:2026-05-26T10:00:00.000Z',
        event_type: 'reply_received',
        message_id: null,
        payload,
      }),
    )
  })

  it('derives dedupe identity from wrapped Instantly data payloads', async () => {
    const env = baseEnv({ INSTANTLY_WEBHOOK_SECRET: 'secret' })
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    const app = new Hono()
    app.route('/webhooks/instantly', instantlyWebhookRoute)
    const payload = {
      event_type: 'reply_received',
      data: {
        timestamp: '2026-05-26T10:00:00.000Z',
        campaign_id: '11111111-0000-0000-0000-000000000001',
        lead_email: 'User@Example.com',
        email_id: 'email_1',
      },
    }

    const res = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: { 'x-instantly-webhook-secret': 'secret' },
        body: JSON.stringify(payload),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(env.EVENTS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'instantly',
        event_id:
          'instantly:reply_received:11111111-0000-0000-0000-000000000001:user@example.com:2026-05-26T10:00:00.000Z',
        event_type: 'reply_received',
        message_id: 'email_1',
        payload,
      }),
    )
  })

  it('normalizes non-string Instantly event types before queueing', async () => {
    const env = baseEnv({ INSTANTLY_WEBHOOK_SECRET: 'secret' })
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    const app = new Hono()
    app.route('/webhooks/instantly', instantlyWebhookRoute)

    const res = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: { 'x-instantly-webhook-secret': 'secret' },
        body: JSON.stringify({ event_type: { nested: 'reply' }, id: 'inst_1' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(env.EVENTS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'instantly',
        event_type: 'unknown',
        message_id: 'inst_1',
      }),
    )
  })

  it('rejects authenticated Instantly JSON payloads that are not objects', async () => {
    const env = baseEnv({ INSTANTLY_WEBHOOK_SECRET: 'secret' })
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    const app = new Hono()
    app.route('/webhooks/instantly', instantlyWebhookRoute)

    const res = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: { 'x-instantly-webhook-secret': 'secret' },
        body: 'null',
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid payload' })
    expect(env.EVENTS_QUEUE.send).not.toHaveBeenCalled()
  })

  it('rejects bad secrets and invalid JSON', async () => {
    const env = baseEnv({ INSTANTLY_WEBHOOK_SECRET: 'secret' })
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    const app = new Hono()
    app.route('/webhooks/instantly', instantlyWebhookRoute)

    const badSecret = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: { 'x-instantly-webhook-secret': 'wrong' },
        body: '{}',
      },
      env,
    )
    const badJson = await app.request(
      '/webhooks/instantly',
      {
        method: 'POST',
        headers: { 'x-instantly-webhook-secret': 'secret' },
        body: '{bad',
      },
      env,
    )

    expect(badSecret.status).toBe(401)
    expect(badJson.status).toBe(400)
    expect(env.EVENTS_QUEUE.send).not.toHaveBeenCalled()
    expect(dbInsertValues).not.toHaveBeenCalled()
  })
})

describe('queue consumer Instantly persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbUpdateWhereResult = null
    contactSelectRows = []
    sequenceRunSelectRows = []
    eventSelectRows = []
  })

  it('persists Instantly queue events through the raw event insert path', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'evt_1',
              payload: { id: 'evt_1' },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry: vi.fn(),
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'instantly',
        message_id: 'evt_1',
        type: 'reply_received',
        payload: { id: 'evt_1' },
        received_at: '2026-05-12T10:00:00.000Z',
      }),
    )
    expect(dbInsertOnConflictDoNothing).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('notifies the sequence run DO when an Instantly reply event includes a run id', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    sequenceRunSelectRows = [{ id: 'run_1' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'evt_1',
              payload: {
                id: 'evt_1',
                run_id: 'run_1',
                email: 'user@example.com',
                product: 'camaudit',
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(doFetch).toHaveBeenCalledOnce()
    expect(doFetch.mock.calls[0][0]).toBeInstanceOf(Request)
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'reply_received' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('marks the latest sent run message as replied when an Instantly reply includes a run id', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    sequenceRunSelectRows = [{ id: 'run_1' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'evt_1',
              payload: {
                id: 'evt_1',
                run_id: 'run_1',
                email: 'user@example.com',
                product: 'camaudit',
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE seq_messages'))
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('JOIN seq_steps'))
    expect(bind).toHaveBeenCalledWith('2026-05-12T10:00:00.000Z', 'run_1')
    expect(run).toHaveBeenCalledOnce()
    expect(doFetch).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('does not trust an Instantly reply run id that conflicts with campaign product ownership', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    instantlyCampaignSelectRows = [
      { id: '11111111-0000-0000-0000-000000000001', product_id: 'prod_camaudit' },
    ]
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = []

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'email_1',
              payload: {
                timestamp: '2026-05-26T10:00:00.000Z',
                event_type: 'reply_received',
                campaign_id: '11111111-0000-0000-0000-000000000001',
                lead_email: 'User@Example.com',
                run_id: 'run_floriva-web',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).not.toHaveBeenCalledWith('2026-05-26T10:00:00.000Z', 'run_floriva-web')
    expect(doFetch).not.toHaveBeenCalled()
    expect(dbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_completed_at: expect.any(String),
      }),
    )
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('retries an Instantly direct reply run id until campaign product ownership is synced', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    instantlyCampaignSelectRows = []
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [
      { id: 'run_floriva-web', email: 'user@example.com', product_id: 'prod_floriva_web' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'email_1',
              payload: {
                timestamp: '2026-05-26T10:00:00.000Z',
                event_type: 'reply_received',
                campaign_id: 'campaign_unmapped',
                lead_email: 'User@Example.com',
                run_id: 'run_floriva-web',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).not.toHaveBeenCalledWith('2026-05-26T10:00:00.000Z', 'run_floriva-web')
    expect(doFetch).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('replays Instantly insert conflicts when side-effect completion cannot be proven', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    dbInsertOnConflictDoNothing.mockResolvedValueOnce({ meta: { changes: 0 } })
    sequenceRunSelectRows = [{ id: 'run_1' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'evt_1',
              payload: {
                id: 'evt_1',
                run_id: 'run_1',
                email: 'user@example.com',
                product: 'camaudit',
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'instantly',
        message_id: 'evt_1',
        type: 'reply_received',
      }),
    )
    expect(bind).toHaveBeenCalledWith('2026-05-12T10:00:00.000Z', 'run_1')
    expect(run).toHaveBeenCalledOnce()
    expect(doFetch).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('falls back to active product runs when an Instantly reply omits the run id', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [{ id: 'run_active', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'evt_1',
              payload: {
                id: 'evt_1',
                email: 'User@Example.com',
                product: 'camaudit',
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(doFetch).toHaveBeenCalledOnce()
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'reply_received' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('marks active product run messages as replied when an Instantly reply omits the run id', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [{ id: 'run_active', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'evt_1',
              payload: {
                id: 'evt_1',
                email: 'User@Example.com',
                product: 'camaudit',
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).toHaveBeenCalledWith('2026-05-12T10:00:00.000Z', 'run_active')
    expect(run).toHaveBeenCalledOnce()
    expect(doFetch).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('maps official Instantly reply payloads through campaign product ownership', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    instantlyCampaignSelectRows = [
      { id: '11111111-0000-0000-0000-000000000001', product_id: 'prod_camaudit' },
    ]
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [{ id: 'run_active', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'email_1',
              payload: {
                timestamp: '2026-05-26T10:00:00.000Z',
                event_type: 'reply_received',
                campaign_id: '11111111-0000-0000-0000-000000000001',
                campaign_name: 'CAMAudit cold',
                lead_email: 'User@Example.com',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).toHaveBeenCalledWith('2026-05-26T10:00:00.000Z', 'run_active')
    expect(run).toHaveBeenCalledOnce()
    expect(doFetch).toHaveBeenCalledOnce()
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'reply_received' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('retries Instantly reply payloads until campaign product ownership is synced', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    instantlyCampaignSelectRows = []
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [{ id: 'run_active', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'reply_received',
              message_id: 'email_1',
              payload: {
                timestamp: '2026-05-26T10:00:00.000Z',
                event_type: 'reply_received',
                campaign_id: 'campaign_unmapped',
                lead_email: 'User@Example.com',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
    expect(dbUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_completed_at: expect.any(String),
      }),
    )
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('creates product suppression and cancels product runs for official Instantly unsubscribe payloads', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    instantlyCampaignSelectRows = [
      { id: '11111111-0000-0000-0000-000000000001', product_id: 'prod_camaudit' },
    ]
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [{ id: 'run_active', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'lead_unsubscribed',
              message_id: 'email_1',
              payload: {
                event_type: 'lead_unsubscribed',
                campaign_id: '11111111-0000-0000-0000-000000000001',
                lead_email: 'User@Example.com',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'instantly_webhook',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    expect(new URL(doFetch.mock.calls[0][0].url).pathname).toBe('/cancel')
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: 'suppression:unsubscribed',
    })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('retries Instantly unsubscribe payloads until campaign product ownership is synced', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    instantlyCampaignSelectRows = []
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [{ id: 'run_active', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'lead_unsubscribed',
              message_id: 'email_1',
              payload: {
                event_type: 'lead_unsubscribed',
                campaign_id: 'campaign_unmapped',
                lead_email: 'User@Example.com',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
    expect(dbUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_completed_at: expect.any(String),
      }),
    )
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('creates global suppression and cancels all active runs for official Instantly bounce payloads', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [{ id: 'run_active' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'instantly',
              event_type: 'email_bounced',
              message_id: 'email_1',
              payload: {
                event_type: 'email_bounced',
                campaign_id: '11111111-0000-0000-0000-000000000001',
                lead_email: 'User@Example.com',
                email_id: 'email_1',
              },
              received_at: '2026-05-26T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'global',
      null,
      'hard_bounce',
      'instantly_webhook',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    expect(new URL(doFetch.mock.calls[0][0].url).pathname).toBe('/cancel')
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: 'suppression:hard_bounce',
    })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('acknowledges malformed queue message bodies without aborting the batch', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const malformedAck = vi.fn()
    const malformedRetry = vi.fn()
    const validAck = vi.fn()
    const validRetry = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: null,
            ack: malformedAck,
            retry: malformedRetry,
          },
          {
            body: {
              provider: 'resend',
              event_type: 'email.delivered',
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack: validAck,
            retry: validRetry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(malformedAck).toHaveBeenCalledOnce()
    expect(malformedRetry).not.toHaveBeenCalled()
    expect(validAck).toHaveBeenCalledOnce()
    expect(validRetry).not.toHaveBeenCalled()
    expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: expect.any(String) })
  })

  it('acknowledges queue message bodies with missing payloads as malformed', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.delivered',
              message_id: 'email_1',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbInsertValues).not.toHaveBeenCalled()
    expect(dbUpdateSet).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })
})

describe('queue consumer Resend delivery tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbUpdateWhereResult = null
    messageSelectRows = []
    sequenceRunSelectRows = []
    eventSelectRows = []
  })

  it('acks duplicate Resend provider event ids without replaying message side effects', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    eventSelectRows = [{ id: 'event_existing', sideEffectsCompletedAt: '2026-05-12T10:00:01.000Z' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_id: 'evt_duplicate',
              event_type: 'email.clicked',
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbInsertValues).not.toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'resend',
        provider_event_id: 'evt_duplicate',
      }),
    )
    expect(dbUpdateSet).not.toHaveBeenCalledWith({ first_clicked_at: '2026-05-12T10:00:00.000Z' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('acknowledges conflicting provider event ids without applying new side effects', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    eventSelectRows = [
      {
        id: 'event_existing',
        type: 'email.delivered',
        message_id: 'email_1',
        sideEffectsCompletedAt: null,
      },
    ]
    dbInsertOnConflictDoNothing.mockResolvedValueOnce({ meta: { changes: 0 } })
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_active', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_id: 'evt_conflict',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: { product: 'camaudit' },
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
    expect(dbInsertValues).not.toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'resend',
        provider_event_id: 'evt_conflict',
        type: 'email.unsubscribed',
      }),
    )
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('replays side effects for duplicate provider events until a prior attempt completes them', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const firstAck = vi.fn()
    const firstRetry = vi.fn()
    const secondAck = vi.fn()
    const secondRetry = vi.fn()
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_1', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    const body = {
      provider: 'resend',
      event_id: 'evt_unsubscribed',
      event_type: 'email.unsubscribed',
      message_id: 'email_1',
      payload: {
        data: {
          email_id: 'email_1',
          email: 'User@Example.com',
          tags: [
            { name: 'product', value: 'camaudit' },
            { name: 'run_id', value: 'run_1' },
          ],
        },
      },
      received_at: '2026-05-12T10:00:00.000Z',
    }
    const testEnv = baseEnv({
      SEQUENCE_RUN: {
        idFromName: vi.fn((id: string) => ({ id })),
        get: vi.fn(() => ({ fetch: doFetch })),
      },
    }) as never

    await queueConsumer(
      {
        messages: [{ body, ack: firstAck, retry: firstRetry }],
      } as never,
      testEnv,
    )
    eventSelectRows = [{ id: 'event_existing', sideEffectsCompletedAt: null }]
    await queueConsumer(
      {
        messages: [{ body, ack: secondAck, retry: secondRetry }],
      } as never,
      testEnv,
    )

    expect(doFetch).toHaveBeenCalledTimes(2)
    expect(firstAck).not.toHaveBeenCalled()
    expect(firstRetry).toHaveBeenCalledOnce()
    expect(secondAck).toHaveBeenCalledOnce()
    expect(secondRetry).not.toHaveBeenCalled()
    expect(dbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_completed_at: expect.any(String),
      }),
    )
  })

  it('retries duplicate provider events while another worker holds the side-effect lease', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    productSelectRows = [{ id: 'prod_camaudit' }]
    eventSelectRows = [
      {
        id: 'event_existing',
        sideEffectsStartedAt: '2026-05-12T09:59:59.000Z',
        sideEffectsCompletedAt: null,
      },
    ]
    dbInsertOnConflictDoNothing.mockResolvedValueOnce({ meta: { changes: 0 } })
    dbUpdateWhereResult = (value) =>
      Object.hasOwn(value, 'side_effects_started_at') ? { meta: { changes: 0 } } : undefined

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_id: 'evt_unsubscribed',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [
                    { name: 'product', value: 'camaudit' },
                    { name: 'run_id', value: 'run_1' },
                  ],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('does not release a newer provider event side-effect lease after an older worker fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      const { queueConsumer } = await import('../queues/consumer')
      const ack = vi.fn()
      const retry = vi.fn()
      const doFetch = vi.fn(async () => new Response('failed', { status: 500 }))
      const leaseStartedAt = '2026-05-20T12:34:56.789Z'
      productSelectRows = [{ id: 'prod_camaudit' }]
      sequenceRunSelectRows = [
        { id: 'run_1', email: 'user@example.com', product_id: 'prod_camaudit' },
      ]
      dbUpdateWhereResult = (value) =>
        typeof value.side_effects_started_at === 'string' ? { meta: { changes: 1 } } : undefined

      await queueConsumer(
        {
          messages: [
            {
              body: {
                provider: 'resend',
                event_id: 'evt_unsubscribed',
                event_type: 'email.unsubscribed',
                message_id: 'email_1',
                payload: {
                  data: {
                    email_id: 'email_1',
                    email: 'User@Example.com',
                    tags: [
                      { name: 'product', value: 'camaudit' },
                      { name: 'run_id', value: 'run_1' },
                    ],
                  },
                },
                received_at: '2026-05-12T10:00:00.000Z',
              },
              ack,
              retry,
            },
          ],
        } as never,
        baseEnv({
          SEQUENCE_RUN: {
            idFromName: vi.fn((id: string) => ({ id })),
            get: vi.fn(() => ({ fetch: doFetch })),
          },
        }) as never,
      )

      const releaseWhere = dbUpdateWhere.mock.calls.find(([where], index) =>
        index > 0 &&
        dbUpdateSet.mock.calls[index]?.[0]?.side_effects_started_at === null &&
        !Object.hasOwn(dbUpdateSet.mock.calls[index]?.[0] ?? {}, 'side_effects_completed_at')
          ? where
          : null,
      )?.[0]
      expect(releaseWhere).toBeDefined()
      expect(expressionIncludesValue(releaseWhere, leaseStartedAt, new WeakSet())).toBe(true)
      expect(ack).not.toHaveBeenCalled()
      expect(retry).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('only completes provider event side effects while it still owns the lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      const { queueConsumer } = await import('../queues/consumer')
      const ack = vi.fn()
      const retry = vi.fn()
      const leaseStartedAt = '2026-05-20T12:34:56.789Z'
      dbUpdateWhereResult = (value) =>
        typeof value.side_effects_started_at === 'string' ? { meta: { changes: 1 } } : undefined

      await queueConsumer(
        {
          messages: [
            {
              body: {
                provider: 'resend',
                event_id: 'evt_delivered',
                event_type: 'email.delivered',
                message_id: 'email_1',
                payload: { data: { email_id: 'email_1' } },
                received_at: '2026-05-12T10:00:00.000Z',
              },
              ack,
              retry,
            },
          ],
        } as never,
        baseEnv() as never,
      )

      const completeCallIndex = dbUpdateSet.mock.calls.findIndex(([value]) =>
        Object.hasOwn(value, 'side_effects_completed_at'),
      )
      expect(completeCallIndex).toBeGreaterThanOrEqual(0)
      const completeWhere = dbUpdateWhere.mock.calls[completeCallIndex]?.[0]
      expect(expressionIncludesValue(completeWhere, leaseStartedAt, new WeakSet())).toBe(true)
      expect(ack).toHaveBeenCalledOnce()
      expect(retry).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries instead of acking when provider event side-effect completion loses its lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      const { queueConsumer } = await import('../queues/consumer')
      const ack = vi.fn()
      const retry = vi.fn()
      dbUpdateWhereResult = (value) => {
        if (typeof value.side_effects_started_at === 'string') return { meta: { changes: 1 } }
        if (typeof value.side_effects_completed_at === 'string') return { meta: { changes: 0 } }
        return undefined
      }
      eventSelectRows = [{ id: 'event_existing', sideEffectsCompletedAt: null }]

      await queueConsumer(
        {
          messages: [
            {
              body: {
                provider: 'resend',
                event_id: 'evt_delivered',
                event_type: 'email.delivered',
                message_id: 'email_1',
                payload: { data: { email_id: 'email_1' } },
                received_at: '2026-05-12T10:00:00.000Z',
              },
              ack,
              retry,
            },
          ],
        } as never,
        baseEnv() as never,
      )

      expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: '2026-05-12T10:00:00.000Z' })
      expect(ack).not.toHaveBeenCalled()
      expect(retry).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the matching message as delivered from Resend delivery webhooks', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.delivered',
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry: vi.fn(),
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: '2026-05-12T10:00:00.000Z' })
    expect(dbUpdateWhere).toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('retries Resend message-state webhooks until their message row exists', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    dbUpdateWhereResult = (value) => {
      if (typeof value.side_effects_started_at === 'string') return { meta: { changes: 1 } }
      if (typeof value.delivered_at === 'string') return { meta: { changes: 0 } }
      return undefined
    }

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_id: 'evt_delivered',
              event_type: 'email.delivered',
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: '2026-05-12T10:00:00.000Z' })
    expect(dbUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_completed_at: expect.any(String),
      }),
    )
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it.each([
    ['email.opened', 'opened_at'],
    ['email.clicked', 'first_clicked_at'],
    ['email.bounced', 'bounced_at'],
    ['email.complained', 'complained_at'],
    ['email.suppressed', 'suppressed_at'],
  ] as const)('uses the queued event timestamp when marking %s message state', async (eventType, column) => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: eventType,
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry: vi.fn(),
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbUpdateSet).toHaveBeenCalledWith({ [column]: '2026-05-12T10:00:00.000Z' })
    expect(ack).toHaveBeenCalledOnce()
  })

  it('records async Resend send failures on the message and errors the owning run', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const run = vi.fn(async function run(this: { sql: string; binds: unknown[] }) {
      calls.push({ sql: this.sql, binds: this.binds })
      return { success: true }
    })
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({ sql, binds, run })),
    }))

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.failed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  failed: {
                    reason: 'domain_not_verified',
                    message: 'Domain is not verified',
                  },
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({ DB: { prepare } }) as never,
    )

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE seq_messages'))
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE seq_steps'))
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE seq_sequence_runs'))
    expect(calls.map((call) => call.binds)).toEqual([
      ['2026-05-12T10:00:00.000Z', 'domain_not_verified: Domain is not verified', 'email_1'],
      ['domain_not_verified: Domain is not verified', 'email_1'],
      ['2026-05-12T10:00:00.000Z', 'email_1'],
    ])
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('falls back to the queued message id when a Resend payload is null', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.delivered',
              message_id: 'email_1',
              payload: null,
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: '2026-05-12T10:00:00.000Z' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('falls back to processing time when the queued timestamp is not canonical ISO', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      const { queueConsumer } = await import('../queues/consumer')
      const ack = vi.fn()

      await queueConsumer(
        {
          messages: [
            {
              body: {
                provider: 'resend',
                event_type: 'email.delivered',
                message_id: 'email_1',
                payload: { data: { email_id: 'email_1' } },
                received_at: 'May 12 2026',
              },
              ack,
              retry: vi.fn(),
            },
          ],
        } as never,
        baseEnv() as never,
      )

      expect(dbInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          received_at: '2026-05-20T12:34:56.789Z',
        }),
      )
      expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: '2026-05-20T12:34:56.789Z' })
      expect(ack).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to processing time when the queued timestamp is an impossible ISO date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      const { queueConsumer } = await import('../queues/consumer')
      const ack = vi.fn()

      await queueConsumer(
        {
          messages: [
            {
              body: {
                provider: 'resend',
                event_type: 'email.delivered',
                message_id: 'email_1',
                payload: { data: { email_id: 'email_1' } },
                received_at: '2026-02-31T00:00:00Z',
              },
              ack,
              retry: vi.fn(),
            },
          ],
        } as never,
        baseEnv() as never,
      )

      expect(dbInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          received_at: '2026-05-20T12:34:56.789Z',
        }),
      )
      expect(dbUpdateSet).toHaveBeenCalledWith({ delivered_at: '2026-05-20T12:34:56.789Z' })
      expect(ack).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('guards first_clicked_at so later click webhooks cannot overwrite the first click', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.clicked',
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry: vi.fn(),
          },
        ],
      } as never,
      baseEnv() as never,
    )

    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
    const source = readFileSync(resolve(repoRoot, 'apps/api/src/queues/consumer.ts'), 'utf8')

    expect(dbUpdateSet).toHaveBeenCalledWith({ first_clicked_at: '2026-05-12T10:00:00.000Z' })
    expect(dbUpdateWhere).toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
    expect(source).toMatch(
      /\.where\(\s*and\(eq\(messages\.resend_message_id, resendEmailId\), isNull\(messages\.first_clicked_at\)\),?\s*\)/,
    )
  })

  it('marks the latest active product run message as replied from Resend inbound received emails', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    productSelectRows = [{ id: 'prod_camaudit' }]
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [{ id: 'run_active' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.received',
              message_id: 'inbound_1',
              payload: {
                data: {
                  email_id: 'inbound_1',
                  from: 'User Example <user@example.com>',
                  to: ['CAMAudit <reply@camaudit.com>'],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).toHaveBeenCalledWith('2026-05-12T10:00:00.000Z', 'run_active')
    expect(run).toHaveBeenCalledOnce()
    expect(doFetch).toHaveBeenCalledOnce()
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'reply_received' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('notifies every active product run when Resend inbound replies target a shared reply address', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const run = vi.fn(async () => ({ success: true }))
    const bind = vi.fn(() => ({ run }))
    const prepare = vi.fn(() => ({ bind }))
    productSelectRows = [{ id: 'prod_camaudit' }, { id: 'prod_floriva_web' }]
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    sequenceRunSelectRows = [
      { id: 'run_camaudit', contact_id: 'contact_1', product_id: 'prod_camaudit' },
      { id: 'run_floriva-web', contact_id: 'contact_1', product_id: 'prod_floriva_web' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.received',
              message_id: 'inbound_1',
              payload: {
                data: {
                  email_id: 'inbound_1',
                  from: 'User Example <user@example.com>',
                  to: ['Shared <reply@example.com>'],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        DB: { prepare },
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(bind).toHaveBeenCalledWith('2026-05-12T10:00:00.000Z', 'run_camaudit')
    expect(bind).toHaveBeenCalledWith('2026-05-12T10:00:00.000Z', 'run_floriva-web')
    expect(doFetch).toHaveBeenCalledTimes(2)
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it.each([
    ['email.bounced', 'hard_bounce', 'bounce'],
    ['email.complained', 'spam_complaint', 'complaint'],
    ['email.suppressed', 'provider_suppressed', 'suppression'],
  ] as const)('uses the original message contact when %s omits the recipient', async (eventType, reason, source) => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    messageSelectRows = [{ contact_email: 'user@example.com', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: eventType,
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'global',
      null,
      reason,
      source,
    )
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it.each([
    ['email.bounced', 'hard_bounce', 'bounce'],
    ['email.complained', 'spam_complaint', 'complaint'],
    ['email.suppressed', 'provider_suppressed', 'suppression'],
  ] as const)('cancels active runs when %s creates a terminal suppression', async (eventType, reason, source) => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    messageSelectRows = [
      { contact_id: 'contact_1', contact_email: 'user@example.com', product_id: 'prod_camaudit' },
    ]
    sequenceRunSelectRows = [{ id: 'run_active' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: eventType,
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'global',
      null,
      reason,
      source,
    )
    expect(doFetch).toHaveBeenCalledOnce()
    expect(new URL(doFetch.mock.calls[0][0].url).pathname).toBe('/cancel')
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: `suppression:${reason}`,
    })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('retries bounce webhook messages when suppression cancellation fails', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn(async () => new Response('failed', { status: 500 }))
    messageSelectRows = [
      { contact_id: 'contact_1', contact_email: 'user@example.com', product_id: 'prod_camaudit' },
    ]
    sequenceRunSelectRows = [{ id: 'run_active' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.bounced',
              message_id: 'email_1',
              payload: { data: { email_id: 'email_1' } },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('cancels runs for the suppressed payload email when it differs from message context', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    messageSelectRows = [
      {
        contact_id: 'contact_context',
        contact_email: 'context@example.com',
        product_id: 'prod_camaudit',
      },
    ]
    sequenceRunSelectRows = [{ id: 'run_payload_email', email: 'payload@example.com' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.bounced',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'payload@example.com',
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'payload@example.com',
      'global',
      null,
      'hard_bounce',
      'bounce',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })
})

describe('queue consumer Resend unsubscribe delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbUpdateWhereResult = null
    suppressionsSelectRows = []
    messageSelectRows = []
    productSelectRows = []
    contactSelectRows = []
    sequenceRunSelectRows = []
    addSuppression.mockResolvedValue({ created: true, id: 'supp_1' })
  })

  it('retries unsubscribe webhook messages when DO notification returns an error', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn(async () => new Response('failed', { status: 500 }))
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_1', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [
                    { name: 'product', value: 'camaudit' },
                    { name: 'run_id', value: 'run_1' },
                  ],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
    expect(dbInsertOnConflictDoNothing).toHaveBeenCalledWith()
  })

  it('treats Resend contact.updated unsubscribed contacts as global suppressions', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    sequenceRunSelectRows = [{ id: 'run_active', email: 'user@example.com' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_id: 'evt_contact_updated',
              event_type: 'contact.updated',
              message_id: null,
              payload: {
                data: {
                  email: 'User@Example.com',
                  unsubscribed: true,
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'global',
      null,
      'unsubscribed',
      'webhook',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: 'suppression:unsubscribed',
    })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('retries unsubscribe webhook messages when DO notification throws', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn(async () => {
      throw new Error('DO unavailable')
    })
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_1', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [
                    { name: 'product', value: 'camaudit' },
                    { name: 'run_id', value: 'run_1' },
                  ],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('acknowledges unsubscribe webhook messages with malformed recipient fields without adding suppressions', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: { address: 'User@Example.com' },
                  tags: [{ name: 'run_id', value: 'run_1' }],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(addSuppression).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('accepts Resend unsubscribe tags supplied as an object', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_1', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: ' User@Example.com ',
                  tags: { product: 'camaudit', run_id: 'run_1' },
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('uses the original message product when unsubscribe tags are missing product scope', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    messageSelectRows = [{ product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: ' User@Example.com ',
                  tags: [],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('uses the original message contact and product when an unsubscribe omits the recipient and tags', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    messageSelectRows = [{ contact_email: 'user@example.com', product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  tags: [],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('notifies all active product runs when an unsubscribe includes a run id tag', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const idFromName = vi.fn((id: string) => ({ id }))
    messageSelectRows = [
      {
        contact_id: 'contact_1',
        contact_email: 'user@example.com',
        product_id: 'prod_camaudit',
      },
    ]
    sequenceRunSelectRows = [
      { id: 'run_tagged', contact_id: 'contact_1', product_id: 'prod_camaudit' },
      { id: 'run_other', contact_id: 'contact_1', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [
                    { name: 'product', value: 'camaudit' },
                    { name: 'run_id', value: 'run_tagged' },
                  ],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName,
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(idFromName.mock.calls.map(([runId]) => runId)).toEqual(['run_tagged', 'run_other'])
    expect(doFetch).toHaveBeenCalledTimes(2)
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'unsubscribed' })
    await expect(doFetch.mock.calls[1][0].json()).resolves.toEqual({ event: 'unsubscribed' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('notifies active product runs when an unsubscribe omits the run id tag', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    contactSelectRows = [{ id: 'contact_1', email: 'user@example.com' }]
    messageSelectRows = [
      { contact_id: 'contact_1', contact_email: 'user@example.com', product_id: 'prod_camaudit' },
    ]
    sequenceRunSelectRows = [{ id: 'run_active' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'unsubscribed' })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('does not trust a Resend unsubscribe run id tag without message context', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    const idFromName = vi.fn((id: string) => ({ id }))
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_active', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [
                    { name: 'product', value: 'camaudit' },
                    { name: 'run_id', value: 'run_floriva-web' },
                  ],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName,
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(idFromName.mock.calls.map(([runId]) => runId)).toEqual(['run_active'])
    expect(doFetch).toHaveBeenCalledOnce()
    expect(new URL(doFetch.mock.calls[0][0].url).pathname).toBe('/cancel')
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: 'suppression:unsubscribed',
    })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('cancels active product runs when an unsubscribe has only payload email and product tag', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    const doFetch = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    )
    productSelectRows = [{ id: 'prod_camaudit' }]
    sequenceRunSelectRows = [
      { id: 'run_active', email: 'user@example.com', product_id: 'prod_camaudit' },
    ]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [{ name: 'product', value: 'camaudit' }],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv({
        SEQUENCE_RUN: {
          idFromName: vi.fn((id: string) => ({ id })),
          get: vi.fn(() => ({ fetch: doFetch })),
        },
      }) as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(doFetch).toHaveBeenCalledOnce()
    expect(new URL(doFetch.mock.calls[0][0].url).pathname).toBe('/cancel')
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({
      reason: 'suppression:unsubscribed',
    })
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('prefers the original message product over a conflicting unsubscribe product tag', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    const ack = vi.fn()
    const retry = vi.fn()
    productSelectRows = [{ id: 'prod_floriva_web' }]
    messageSelectRows = [{ product_id: 'prod_camaudit' }]

    await queueConsumer(
      {
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.unsubscribed',
              message_id: 'email_1',
              payload: {
                data: {
                  email_id: 'email_1',
                  email: 'User@Example.com',
                  tags: [{ name: 'product', value: 'floriva-web' }],
                },
              },
              received_at: '2026-05-12T10:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      baseEnv() as never,
    )

    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'webhook',
    )
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })
})

describe('domain health rollup', () => {
  it('aggregates recent messages by sent date and sending domain so late webhooks are folded in', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => ({
        all: vi.fn(async () => ({
          results: sql.includes('GROUP BY sent_date, sending_domain')
            ? [
                {
                  domain: 'ventoralabs.com',
                  date: '2026-05-18',
                  sent: 2,
                  delivered: 1,
                  opened: 1,
                  clicked: 1,
                  bounced: 1,
                  complained: 0,
                },
              ]
            : [],
        })),
        first: vi.fn(async () => null),
        run: vi.fn(async () => {
          calls.push({ sql, binds })
          return {}
        }),
      }),
    }))
    const { handleCron } = await import('../crons/index')

    await handleCron('0 3 * * *', baseEnv({ DB: { prepare } }) as never)

    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('GROUP BY sent_date, sending_domain'),
    )
    expect(calls.some((call) => call.sql.includes('INSERT INTO seq_domain_health'))).toBe(true)
    expect(calls.at(-1)?.binds.slice(1)).toEqual([
      'ventoralabs.com',
      '2026-05-18',
      2,
      1,
      1,
      1,
      1,
      0,
    ])
  })
})

describe('Instantly stats sync cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suppressionsSelectRows = []
    auditSelectRows = []
    messageSelectRows = []
    productSelectRows = []
    contactSelectRows = []
    sequenceRunSelectRows = []
    eventSelectRows = []
    sequenceSelectRows = []
    instantlyCampaignSelectRows = []
    instantlyStatsSelectRows = []
    dbUpdateWhereResult = null
    instantlyListCampaigns.mockReset()
    instantlyGetCampaignAnalytics.mockReset()
    createInstantlyAdapter.mockClear()
  })

  it('fetches Instantly campaigns and stores same-day campaign stats', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      instantlyListCampaigns.mockResolvedValueOnce([
        {
          id: '11111111-0000-0000-0000-000000000001',
          name: 'CAMAudit trial',
          status: 'active',
          created_at: '2026-05-01T00:00:00.000Z',
        },
      ])
      instantlyGetCampaignAnalytics.mockResolvedValueOnce({
        sent: 12,
        opened: 7,
        replied: 2,
        interested: 1,
        bounced: 0,
      })
      const { handleCron } = await import('../crons/index')

      await handleCron('0 * * * *', baseEnv({ INSTANTLY_API_KEY: 'instantly_key' }) as never)

      expect(createInstantlyAdapter).toHaveBeenCalledOnce()
      expect(instantlyListCampaigns).toHaveBeenCalledOnce()
      expect(instantlyGetCampaignAnalytics).toHaveBeenCalledWith(
        '11111111-0000-0000-0000-000000000001',
        '2026-05-20',
      )
      expect(dbInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '11111111-0000-0000-0000-000000000001',
          name: 'CAMAudit trial',
          status: 'active',
          created_at_instantly: '2026-05-01T00:00:00.000Z',
        }),
      )
      expect(dbInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          campaign_id: '11111111-0000-0000-0000-000000000001',
          date: '2026-05-20',
          sent: 12,
          opened: 7,
          replied: 2,
          interested: 1,
          bounced: 0,
        }),
      )
      expect(dbInsertOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(Array),
          set: expect.objectContaining({
            sent: 12,
            opened: 7,
            replied: 2,
            interested: 1,
            bounced: 0,
          }),
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves retired Instantly campaign rows when provider sync reports them active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      instantlyCampaignSelectRows = [
        {
          id: '11111111-0000-0000-0000-000000000001',
          status: 'retired',
        },
      ]
      instantlyListCampaigns.mockResolvedValueOnce([
        {
          id: '11111111-0000-0000-0000-000000000001',
          name: 'SkillLedger cold',
          status: 'active',
          created_at: '2026-05-01T00:00:00.000Z',
        },
      ])
      instantlyGetCampaignAnalytics.mockResolvedValueOnce({
        sent: 12,
        opened: 7,
        replied: 2,
        interested: 1,
        bounced: 0,
      })
      const { handleCron } = await import('../crons/index')

      await handleCron('0 * * * *', baseEnv({ INSTANTLY_API_KEY: 'instantly_key' }) as never)

      expect(dbUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SkillLedger cold',
          status: 'retired',
          synced_at: '2026-05-20T12:34:56.789Z',
        }),
      )
      expect(instantlyGetCampaignAnalytics).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('continues syncing remaining Instantly campaigns when one analytics request fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    try {
      instantlyListCampaigns.mockResolvedValueOnce([
        {
          id: '11111111-0000-0000-0000-000000000001',
          name: 'Provider 500 campaign',
          status: 'active',
          created_at: '2026-05-01T00:00:00.000Z',
        },
        {
          id: '22222222-0000-0000-0000-000000000002',
          name: 'Healthy campaign',
          status: 'active',
          created_at: '2026-05-02T00:00:00.000Z',
        },
      ])
      instantlyGetCampaignAnalytics
        .mockRejectedValueOnce(
          new Error(
            'Instantly getAnalytics failed with 500 for campaign 11111111-0000-0000-0000-000000000001',
          ),
        )
        .mockResolvedValueOnce({
          sent: 8,
          opened: 4,
          replied: 1,
          interested: 1,
          bounced: 0,
        })
      const { handleCron } = await import('../crons/index')

      await expect(
        handleCron('0 * * * *', baseEnv({ INSTANTLY_API_KEY: 'instantly_key' }) as never),
      ).resolves.toBeUndefined()

      expect(instantlyGetCampaignAnalytics).toHaveBeenCalledTimes(2)
      expect(dbInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          campaign_id: '22222222-0000-0000-0000-000000000002',
          date: '2026-05-20',
          sent: 8,
          opened: 4,
          replied: 1,
          interested: 1,
          bounced: 0,
        }),
      )
      expect(dbInsertValues).not.toHaveBeenCalledWith(
        expect.objectContaining({
          campaign_id: '11111111-0000-0000-0000-000000000001',
          date: '2026-05-20',
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a transient D1 reset mid-sync and still persists campaign stats', async () => {
    instantlyListCampaigns.mockResolvedValueOnce([
      {
        id: '11111111-0000-0000-0000-000000000001',
        name: 'CAMAudit cold',
        status: 'active',
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ])
    instantlyGetCampaignAnalytics.mockResolvedValueOnce({
      sent: 5,
      opened: 3,
      replied: 1,
      interested: 1,
      bounced: 0,
    })
    // First D1 write throws the transient "object to be reset" error; the retry succeeds.
    dbInsertValues.mockImplementationOnce(() => {
      throw new Error(
        'D1_ERROR: Internal error while starting up D1 DB storage caused object to be reset; reference = ; wdErrId = test',
      )
    })
    const { handleCron } = await import('../crons/index')

    await expect(
      handleCron('0 * * * *', baseEnv({ INSTANTLY_API_KEY: 'instantly_key' }) as never),
    ).resolves.toBeUndefined()

    // The campaign insert was retried after the transient failure: it must have
    // been issued twice (the failed attempt plus the successful retry).
    const campaignInsertCalls = dbInsertValues.mock.calls.filter(
      ([value]) =>
        value?.id === '11111111-0000-0000-0000-000000000001' && value?.name === 'CAMAudit cold',
    )
    expect(campaignInsertCalls).toHaveLength(2)
    // ...and the sync continued through to writing campaign stats.
    expect(dbInsertOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ sent: 5, replied: 1 }) }),
    )
  })

  it('skips Instantly sync when the API key is not configured', async () => {
    const { handleCron } = await import('../crons/index')

    await handleCron('0 * * * *', baseEnv() as never)

    expect(createInstantlyAdapter).not.toHaveBeenCalled()
    expect(instantlyListCampaigns).not.toHaveBeenCalled()
  })
})

describe('rot detector cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sequenceSelectRows = []
    sequenceRunSelectRows = []
  })

  it('counts active sequences with no recent runs as rot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:34:56.789Z'))
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      sequenceSelectRows = [
        { slug: 'fresh-sequence', product_id: 'prod_camaudit', is_active: true },
        { slug: 'stale-sequence', product_id: 'prod_floriva_web', is_active: true },
      ]
      sequenceRunSelectRows = [
        {
          id: 'run_recent',
          sequence_slug: 'fresh-sequence',
          started_at: '2026-05-01T00:00:00.000Z',
        },
      ]
      const { handleCron } = await import('../crons/index')

      await handleCron('30 3 * * *', baseEnv() as never)

      const infoLogs = consoleLog.mock.calls
        .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
        .filter((entry) => entry.level === 'info')
      expect(infoLogs).toContainEqual(
        expect.objectContaining({
          message: 'Rot detected',
          sequence: 'stale-sequence',
          product: 'prod_floriva_web',
        }),
      )
      expect(infoLogs).toContainEqual(
        expect.objectContaining({
          message: 'Rot detector complete',
          active_sequences: 2,
          rot_count: 1,
        }),
      )
    } finally {
      consoleLog.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('D1 backup cron', () => {
  it('writes paged JSON backup artifacts for seq tables to R2', async () => {
    const put = vi.fn()
    const contactsRows = Array.from({ length: 501 }, (_, index) => ({
      id: `contact_${index + 1}`,
      email: `user-${index + 1}@example.com`,
    }))
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((limit: number, offset: number) => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM `seq_contacts`')) {
            return { results: contactsRows.slice(offset, offset + limit) }
          }
          if (sql.includes('FROM `seq_messages`')) {
            return offset === 0
              ? { results: [{ id: 'message_1', contact_id: 'contact_1' }] }
              : { results: [] }
          }
          return { results: [] }
        }),
      })),
      all: vi.fn(async () => {
        if (sql.includes('sqlite_master')) {
          return {
            results: [{ name: 'seq_contacts' }, { name: 'seq_messages' }],
          }
        }
        return { results: [] }
      }),
    }))
    const { handleCron } = await import('../crons/index')

    await handleCron(
      '0 4 * * *',
      baseEnv({
        DB: { prepare },
        LOGS_BUCKET: { put },
      }) as never,
    )

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'))
    expect(prepare).toHaveBeenCalledWith(
      'SELECT * FROM `seq_contacts` ORDER BY rowid ASC LIMIT ? OFFSET ?',
    )
    expect(prepare).toHaveBeenCalledWith(
      'SELECT * FROM `seq_messages` ORDER BY rowid ASC LIMIT ? OFFSET ?',
    )
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^backups\/d1\/\d{4}-\d{2}-\d{2}T.*\/seq_contacts\/000001\.json$/),
      expect.any(String),
      expect.objectContaining({
        httpMetadata: { contentType: 'application/json' },
      }),
    )
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^backups\/d1\/\d{4}-\d{2}-\d{2}T.*\/manifest\.json$/),
      expect.any(String),
      expect.objectContaining({
        httpMetadata: { contentType: 'application/json' },
      }),
    )
    expect(put).toHaveBeenCalledWith(
      'backups/d1/latest.json',
      expect.any(String),
      expect.objectContaining({
        httpMetadata: { contentType: 'application/json' },
      }),
    )
    const contactsChunk = JSON.parse(put.mock.calls[0][1] as string)
    expect(contactsChunk).toMatchObject({
      table: 'seq_contacts',
      offset: 0,
      count: 500,
      rows: contactsRows.slice(0, 500),
    })
    const manifestCall = put.mock.calls.find(
      ([key]) => typeof key === 'string' && key.endsWith('/manifest.json'),
    )
    const manifest = JSON.parse(manifestCall?.[1] as string)
    expect(manifest).toMatchObject({
      schema_version: 1,
      consistency: 'best_effort_non_transactional',
      tables: {
        seq_contacts: {
          count: 501,
          chunks: [
            {
              key: expect.stringMatching(/^backups\/d1\/.*\/seq_contacts\/000001\.json$/),
              count: 500,
              offset: 0,
            },
            {
              key: expect.stringMatching(/^backups\/d1\/.*\/seq_contacts\/000002\.json$/),
              count: 1,
              offset: 500,
            },
          ],
        },
        seq_messages: {
          count: 1,
          chunks: [
            {
              key: expect.stringMatching(/^backups\/d1\/.*\/seq_messages\/000001\.json$/),
              count: 1,
              offset: 0,
            },
          ],
        },
      },
    })
  })

  it('retries transient R2 put failures while writing backup artifacts', async () => {
    const transientR2Error = new Error(
      'put: We encountered an internal error. Please try again. (10001)',
    )
    const put = vi.fn().mockRejectedValueOnce(transientR2Error).mockResolvedValue(undefined)
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM `seq_contacts`')) {
            return { results: [{ id: 'contact_1', email: 'user-1@example.com' }] }
          }
          return { results: [] }
        }),
      })),
      all: vi.fn(async () => {
        if (sql.includes('sqlite_master')) {
          return {
            results: [{ name: 'seq_contacts' }],
          }
        }
        return { results: [] }
      }),
    }))
    const { handleCron } = await import('../crons/index')

    await expect(
      handleCron(
        '0 4 * * *',
        baseEnv({
          DB: { prepare },
          LOGS_BUCKET: { put },
        }) as never,
      ),
    ).resolves.toBeUndefined()

    expect(put).toHaveBeenCalledTimes(4)
    expect(put.mock.calls[0][0]).toMatch(
      /^backups\/d1\/\d{4}-\d{2}-\d{2}T.*\/seq_contacts\/000001\.json$/,
    )
    expect(put.mock.calls[1][0]).toBe(put.mock.calls[0][0])
  })

  it('ignores non-sequencer tables when enumerating backup tables', async () => {
    const put = vi.fn()
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
      })),
      all: vi.fn(async () => {
        if (sql.includes('sqlite_master')) {
          return {
            results: [{ name: 'seq_contacts' }, { name: 'seqXunexpected' }],
          }
        }
        return { results: [] }
      }),
    }))
    const { handleCron } = await import('../crons/index')

    await handleCron(
      '0 4 * * *',
      baseEnv({
        DB: { prepare },
        LOGS_BUCKET: { put },
      }) as never,
    )

    expect(prepare).toHaveBeenCalledWith(
      'SELECT * FROM `seq_contacts` ORDER BY rowid ASC LIMIT ? OFFSET ?',
    )
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining('seqXunexpected'))
  })
})

describe('lead magnet tokenized assets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbUpdateWhereResult = null
  })

  it('keeps legacy tokens without a bucket on the Sequencer assets bucket', async () => {
    const body = new Blob(['asset'], { type: 'application/pdf' })
    const env = baseEnv({
      SESSIONS: {
        get: vi.fn(async () =>
          JSON.stringify({
            slug: 'tenant-checklist',
            assetKey: 'lead-magnets/tenant.pdf',
            expiresAt: Date.now() + 60_000,
          }),
        ),
        put: vi.fn(),
        delete: vi.fn(),
      },
      ASSETS_BUCKET: {
        get: vi.fn(async () => ({
          body: body.stream(),
          httpMetadata: { contentType: 'application/pdf' },
          size: 5,
        })),
      },
    })
    const { leadMagnetAssetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/assets/lead-magnets', leadMagnetAssetsRoute)

    const res = await app.request('/assets/lead-magnets/tenant-checklist?token=tok_1', {}, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(await res.text()).toBe('asset')
    expect(env.ASSETS_BUCKET.get).toHaveBeenCalledWith('lead-magnets/tenant.pdf')
  })

  it('streams product-owned R2 assets when the token names a product bucket', async () => {
    const body = new Blob(['asset'], { type: 'application/pdf' })
    const productBucket = {
      get: vi.fn(async () => ({
        body: body.stream(),
        httpMetadata: { contentType: 'application/pdf' },
        size: 5,
      })),
    }
    const env = baseEnv({
      SESSIONS: {
        get: vi.fn(async () =>
          JSON.stringify({
            slug: 'tenant-checklist',
            assetBucket: 'floriva-lead-magnets',
            assetKey: 'lead-magnets/tenant.pdf',
            expiresAt: Date.now() + 60_000,
          }),
        ),
        put: vi.fn(),
        delete: vi.fn(),
      },
      FLORIVA_LEAD_MAGNETS: productBucket,
    })
    const { leadMagnetAssetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/assets/lead-magnets', leadMagnetAssetsRoute)

    const res = await app.request('/assets/lead-magnets/tenant-checklist?token=tok_1', {}, env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('asset')
    expect(productBucket.get).toHaveBeenCalledWith('lead-magnets/tenant.pdf')
    expect(env.ASSETS_BUCKET.get).not.toHaveBeenCalled()
  })

  it('rejects missing, expired, and wrong asset tokens', async () => {
    const { leadMagnetAssetsRoute, leadMagnetsRoute } = await import(
      '../routes/api/v1/lead-magnets'
    )
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)
    app.route('/assets/lead-magnets', leadMagnetAssetsRoute)

    const missing = await app.request('/assets/lead-magnets/tenant-checklist', {}, baseEnv())
    const expired = await app.request(
      '/assets/lead-magnets/tenant-checklist?token=tok_1',
      {},
      baseEnv({
        SESSIONS: {
          get: vi.fn(async () =>
            JSON.stringify({ slug: 'tenant-checklist', assetKey: 'x', expiresAt: Date.now() - 1 }),
          ),
          put: vi.fn(),
          delete: vi.fn(),
        },
      }),
    )
    const wrong = await app.request(
      '/assets/lead-magnets/tenant-checklist?token=tok_1',
      {},
      baseEnv({
        SESSIONS: {
          get: vi.fn(async () =>
            JSON.stringify({ slug: 'other', assetKey: 'x', expiresAt: Date.now() + 60_000 }),
          ),
          put: vi.fn(),
          delete: vi.fn(),
        },
      }),
    )

    expect(missing.status).toBe(400)
    expect(expired.status).toBe(410)
    expect(wrong.status).toBe(403)
  })

  it('rejects zero timestamp asset tokens as expired before R2 lookup', async () => {
    const { leadMagnetAssetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/assets/lead-magnets', leadMagnetAssetsRoute)
    const deleteToken = vi.fn()
    const env = baseEnv({
      SESSIONS: {
        get: vi.fn(async () =>
          JSON.stringify({
            slug: 'tenant-checklist',
            assetKey: 'lead-magnets/tenant.pdf',
            expiresAt: 0,
          }),
        ),
        put: vi.fn(),
        delete: deleteToken,
      },
    })

    const res = await app.request('/assets/lead-magnets/tenant-checklist?token=tok_1', {}, env)

    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'asset token expired' })
    expect(deleteToken).toHaveBeenCalledWith('lead_magnet_asset:tok_1')
    expect(env.ASSETS_BUCKET.get).not.toHaveBeenCalled()
  })

  it('rejects parsed asset tokens that are not JSON objects', async () => {
    const { leadMagnetAssetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/assets/lead-magnets', leadMagnetAssetsRoute)

    for (const rawToken of ['null', '[]', '"token"']) {
      const deleteToken = vi.fn()
      const res = await app.request(
        '/assets/lead-magnets/tenant-checklist?token=tok_1',
        {},
        baseEnv({
          SESSIONS: {
            get: vi.fn(async () => rawToken),
            put: vi.fn(),
            delete: deleteToken,
          },
        }),
      )

      expect(res.status).toBe(410)
      expect(await res.json()).toEqual({ error: 'asset token invalid' })
      expect(deleteToken).toHaveBeenCalledWith('lead_magnet_asset:tok_1')
    }
  })

  it('rejects asset tokens with malformed field types before R2 lookup', async () => {
    const { leadMagnetAssetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/assets/lead-magnets', leadMagnetAssetsRoute)

    for (const token of [
      { slug: 'tenant-checklist', assetKey: 123, expiresAt: Date.now() + 60_000 },
      {
        slug: 'tenant-checklist',
        assetBucket: {},
        assetKey: 'lead-magnets/tenant.pdf',
        expiresAt: Date.now() + 60_000,
      },
      { slug: 'tenant-checklist', assetKey: 'lead-magnets/tenant.pdf', expiresAt: 'soon' },
    ]) {
      const deleteToken = vi.fn()
      const env = baseEnv({
        SESSIONS: {
          get: vi.fn(async () => JSON.stringify(token)),
          put: vi.fn(),
          delete: deleteToken,
        },
      })

      const res = await app.request('/assets/lead-magnets/tenant-checklist?token=tok_1', {}, env)

      expect(res.status).toBe(410)
      expect(await res.json()).toEqual({ error: 'asset token invalid' })
      expect(deleteToken).toHaveBeenCalledWith('lead_magnet_asset:tok_1')
      expect(env.ASSETS_BUCKET.get).not.toHaveBeenCalled()
    }
  })
})
