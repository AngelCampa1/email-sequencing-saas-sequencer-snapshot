import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireProductApiClient = vi.fn()
const requireProductApiClientContext = vi.fn()
const checkSuppression = vi.fn()
const checkFirewall = vi.fn()
const audit = vi.fn()
const trackMetric = vi.fn()
const createLogger = vi.fn(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const sequence_runs = {
  __name: 'sequence_runs',
  id: 'sequence_runs.id',
  contact_id: 'sequence_runs.contact_id',
  product_id: 'sequence_runs.product_id',
  sequence_slug: 'sequence_runs.sequence_slug',
  status: 'sequence_runs.status',
  started_at: 'sequence_runs.started_at',
}
const sequences = {
  __name: 'sequences',
  slug: 'sequences.slug',
  product_id: 'sequences.product_id',
  is_active: 'sequences.is_active',
}
const products = {
  __name: 'products',
  id: 'products.id',
}
const contacts = {
  __name: 'contacts',
  id: 'contacts.id',
  email: 'contacts.email',
}
const contact_products = {
  __name: 'contact_products',
  contact_id: 'contact_products.contact_id',
  product_id: 'contact_products.product_id',
}
const lead_magnets = {
  __name: 'lead_magnets',
  slug: 'lead_magnets.slug',
  active: 'lead_magnets.active',
}
const contact_sources = {
  __name: 'contact_sources',
}
const events = {
  __name: 'events',
}

type Condition = { op: string; column?: unknown; value?: unknown; conditions?: Condition[] }
type InsertCall = { table: { __name: string }; values: unknown }
type UpdateCall = { table: { __name: string }; values: unknown; condition?: Condition }

const selectQueues = new Map<string, unknown[][]>()
const inserts: InsertCall[] = []
const conflictIgnoredInserts: InsertCall[] = []
const updates: UpdateCall[] = []
let sequenceRunInsertError: Error | null = null
let contactInsertError: Error | null = null
const activeRun = {
  id: 'run_oldest',
  contact_id: 'contact_1',
  product_id: 'prod_1',
  sequence_slug: 'other-sequence',
  status: 'running',
  started_at: '2026-05-01T00:00:00.000Z',
}
const otherProductActiveRun = {
  ...activeRun,
  id: 'run_other_product',
  product_id: 'prod_2',
}

function queueSelect(table: { __name: string }, rows: unknown[]) {
  const existing = selectQueues.get(table.__name) ?? []
  existing.push(rows)
  selectQueues.set(table.__name, existing)
}

function conditionIncludesColumn(condition: Condition | undefined, column: unknown): boolean {
  if (!condition) return false
  if (condition.column === column) return true
  return condition.conditions?.some((child) => conditionIncludesColumn(child, column)) ?? false
}

function conditionValueForColumn(condition: Condition | undefined, column: unknown): unknown {
  if (!condition) return undefined
  if (condition.column === column) return condition.value
  for (const child of condition.conditions ?? []) {
    const value = conditionValueForColumn(child, column)
    if (value !== undefined) return value
  }
  return undefined
}

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown): Condition => ({ op: 'eq', column, value }),
  and: (...conditions: Condition[]): Condition => ({ op: 'and', conditions }),
  asc: (column: unknown) => ({ op: 'asc', column }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: (table: { __name: string }) => {
        let whereCondition: Condition | undefined
        const builder = {
          where: (condition: Condition) => {
            whereCondition = condition
            return builder
          },
          orderBy: () => builder,
          limit: async () => {
            if (
              table === sequence_runs &&
              conditionIncludesColumn(whereCondition, sequence_runs.sequence_slug)
            ) {
              return []
            }
            const queued = selectQueues.get(table.__name) ?? []
            const rows = queued.shift() ?? []
            if (
              table === sequence_runs &&
              conditionIncludesColumn(whereCondition, sequence_runs.product_id)
            ) {
              const productId = conditionValueForColumn(whereCondition, sequence_runs.product_id)
              return rows.filter(
                (row) => (row as { product_id?: unknown }).product_id === productId,
              )
            }
            return rows
          },
        }
        return builder
      },
    })),
    insert: vi.fn((table: { __name: string }) => ({
      values: vi.fn((values: unknown) => {
        if (table === contacts && contactInsertError) {
          const error = contactInsertError
          contactInsertError = null
          throw error
        }
        if (table === sequence_runs && sequenceRunInsertError) {
          const error = sequenceRunInsertError
          sequenceRunInsertError = null
          throw error
        }
        inserts.push({ table, values })
        return {
          onConflictDoNothing: vi.fn(async () => {
            conflictIgnoredInserts.push({ table, values })
          }),
        }
      }),
    })),
    update: vi.fn((table: { __name: string }) => {
      let values: unknown
      return {
        set: vi.fn((nextValues: unknown) => {
          values = nextValues
          return {
            where: vi.fn(async (condition: Condition) => {
              updates.push({ table, values, condition })
            }),
          }
        }),
      }
    }),
  })),
  contacts,
  contact_products,
  contact_sources,
  events,
  lead_magnets,
  products,
  sequence_runs,
  sequences,
}))

vi.mock('../lib/product-api-auth', () => ({
  requireProductApiClient,
  requireProductApiClientContext,
}))
vi.mock('../lib/suppression', () => ({ checkSuppression }))
vi.mock('../lib/firewall', () => ({ checkFirewall }))
vi.mock('../lib/audit', () => ({ audit }))
vi.mock('../lib/observability', () => ({ createLogger, trackMetric }))
vi.mock('../lib/variant', () => ({ assignVariant: vi.fn(() => 'control') }))

function baseEnv(overrides: Record<string, unknown> = {}) {
  const sequenceRunFetch = vi.fn<(req: Request) => Promise<Response>>(
    async () => new Response(JSON.stringify({ ok: true })),
  )
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    DB: {},
    SUPPRESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    SESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ASSETS_BUCKET: { get: vi.fn() },
    ANALYTICS: { writeDataPoint: vi.fn() },
    EVENTS_QUEUE: { send: vi.fn() },
    SEQUENCE_RUN: {
      idFromName: vi.fn((id: string) => ({ id })),
      get: vi.fn(() => ({ fetch: sequenceRunFetch })),
    },
    __sequenceRunFetch: sequenceRunFetch,
    ...overrides,
  }
}

describe('one active sequence per contact route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectQueues.clear()
    inserts.length = 0
    conflictIgnoredInserts.length = 0
    updates.length = 0
    sequenceRunInsertError = null
    contactInsertError = null
    requireProductApiClient.mockResolvedValue('camaudit')
    requireProductApiClientContext.mockResolvedValue({
      productSlug: 'camaudit',
      clientId: 'client.access',
    })
    checkSuppression.mockResolvedValue({ suppressed: false })
    checkFirewall.mockResolvedValue({ blocked: false })
  })

  it('returns an existing running run for the contact even when the requested sequence slug differs', async () => {
    queueSelect(sequences, [
      {
        slug: 'new-sequence',
        product_id: 'prod_1',
        version: 1,
        is_active: true,
        definition: { variants: [] },
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [activeRun])

    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'USER@example.com', sequence_slug: 'new-sequence' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run_id: 'run_oldest', status: 'already_running' })
    expect(inserts.some((call) => call.table === sequence_runs)).toBe(false)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })

  it('creates and starts a run when the contact has no active run', async () => {
    queueSelect(sequences, [
      {
        slug: 'new-sequence',
        product_id: 'prod_1',
        version: 1,
        is_active: true,
        definition: { variants: [] },
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [])

    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', sequence_slug: 'new-sequence' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      run_id: expect.any(String),
      status: 'enrolled',
      variant: null,
    })
    expect(inserts.some((call) => call.table === sequence_runs)).toBe(true)
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledOnce()
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('creates and starts an enrollment run when the contact only has an active run for another product', async () => {
    queueSelect(sequences, [
      {
        slug: 'new-sequence',
        product_id: 'prod_1',
        version: 1,
        is_active: true,
        definition: { variants: [] },
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [otherProductActiveRun])

    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', sequence_slug: 'new-sequence' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      run_id: expect.any(String),
      status: 'enrolled',
      variant: null,
    })
    expect(inserts).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        contact_id: 'contact_1',
        product_id: 'prod_1',
        sequence_slug: 'new-sequence',
      }),
    })
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledOnce()
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('enrolls with the winning contact when concurrent contact creation wins the email race', async () => {
    queueSelect(sequences, [
      {
        slug: 'new-sequence',
        product_id: 'prod_1',
        version: 1,
        is_active: true,
        definition: { variants: [] },
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [])
    queueSelect(contacts, [{ id: 'contact_winner', email: 'user@example.com' }])
    queueSelect(contact_products, [])
    queueSelect(sequence_runs, [])
    contactInsertError = new Error('D1_ERROR: UNIQUE constraint failed: seq_contacts.email')

    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', sequence_slug: 'new-sequence' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    expect(inserts).toContainEqual({
      table: contact_products,
      values: expect.objectContaining({
        contact_id: 'contact_winner',
        product_id: 'prod_1',
      }),
    })
    expect(inserts).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        contact_id: 'contact_winner',
        product_id: 'prod_1',
      }),
    })
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('rejects blank enrollment sequence fields before side effects', async () => {
    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', sequence_slug: '   ', source: '   ' }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid request' })
    expect(checkSuppression).not.toHaveBeenCalled()
    expect(checkFirewall).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })

  it('marks a newly inserted enrollment run errored when the DO start fails', async () => {
    queueSelect(sequences, [
      {
        slug: 'new-sequence',
        product_id: 'prod_1',
        version: 1,
        is_active: true,
        definition: { variants: [] },
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [])

    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv({
      SEQUENCE_RUN: {
        idFromName: vi.fn((id: string) => ({ id })),
        get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('boom', { status: 500 })) })),
      },
    })

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', sequence_slug: 'new-sequence' }),
      },
      env,
    )

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'sequence_start_failed',
      detail: 'Durable Object start failed',
    })
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ status: 'errored' }),
      condition: expect.objectContaining({ column: sequence_runs.id }),
    })
    expect(trackMetric).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'enrollment.created',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it('returns the winning run when concurrent enrollment loses the unique-index race', async () => {
    queueSelect(sequences, [
      {
        slug: 'new-sequence',
        product_id: 'prod_1',
        version: 1,
        is_active: true,
        definition: { variants: [] },
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [])
    queueSelect(sequence_runs, [activeRun])
    sequenceRunInsertError = new Error(
      'D1_ERROR: UNIQUE constraint failed: seq_sequence_runs.contact_id, seq_sequence_runs.product_id',
    )

    const { enrollmentsRoute } = await import('../routes/api/v1/enrollments')
    const app = new Hono()
    app.route('/api/v1/enrollments', enrollmentsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/enrollments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', sequence_slug: 'new-sequence' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run_id: 'run_oldest', status: 'already_running' })
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })

  it('delivers a lead magnet asset and reuses the current run without starting a fulfillment DO', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [activeRun])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com', source: 'lead_magnet_form' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: 'run_oldest',
      status: 'already_running',
    })
    expect(inserts.some((call) => call.table === sequence_runs)).toBe(false)
    expect(inserts).toContainEqual({
      table: contact_products,
      values: expect.objectContaining({
        contact_id: 'contact_1',
        product_id: 'prod_1',
      }),
    })
    expect(conflictIgnoredInserts).toContainEqual({
      table: contact_products,
      values: expect.objectContaining({
        contact_id: 'contact_1',
        product_id: 'prod_1',
      }),
    })
    expect(inserts).toContainEqual({
      table: contact_sources,
      values: expect.objectContaining({
        contact_id: 'contact_1',
        product_id: 'prod_1',
        lead_magnet_id: 'lm_1',
        source: 'lead_magnet_form',
      }),
    })
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
    expect(env.SESSIONS.put).toHaveBeenCalledOnce()
  })

  it('replays idempotent lead magnet downloads without duplicating side effects', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [activeRun])
    const kv = new Map<string, string>()
    const env = baseEnv({
      SESSIONS: {
        get: vi.fn(async (key: string) => kv.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kv.set(key, value)
        }),
        delete: vi.fn(),
      },
    })

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)
    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': 'client.access',
        'Idempotency-Key': 'tenant-user-1',
      },
      body: JSON.stringify({ email: 'user@example.com', source: 'lead_magnet_form' }),
    }

    const first = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      request,
      env,
    )
    const firstBody = await first.json()
    const insertCount = inserts.length
    const second = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      request,
      env,
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(firstBody)
    expect(inserts).toHaveLength(insertCount)
    expect(inserts.filter((call) => call.table === contact_sources)).toHaveLength(1)
    expect(env.SESSIONS.put).toHaveBeenCalledTimes(2)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('rejects lead magnet idempotency key reuse with a different request body', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [activeRun])
    const kv = new Map<string, string>()
    const env = baseEnv({
      SESSIONS: {
        get: vi.fn(async (key: string) => kv.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kv.set(key, value)
        }),
        delete: vi.fn(),
      },
    })

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)
    const requestHeaders = {
      'Content-Type': 'application/json',
      'CF-Access-Client-Id': 'client.access',
      'Idempotency-Key': 'tenant-user-1',
    }

    const first = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ email: 'user@example.com', source: 'lead_magnet_form' }),
      },
      env,
    )
    const insertCount = inserts.length
    const second = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ email: 'other@example.com', source: 'lead_magnet_form' }),
      },
      env,
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      error: 'idempotency_key_conflict',
      detail: 'Idempotency-Key was already used with a different lead magnet download request',
    })
    expect(inserts).toHaveLength(insertCount)
    expect(env.SESSIONS.put).toHaveBeenCalledTimes(2)
  })

  it('normalizes lead magnet emails before suppression checks, contact creation, and audit', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [])
    queueSelect(sequence_runs, [activeRun])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: '  USER@example.com  ' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(checkSuppression).toHaveBeenCalledWith(env, 'user@example.com', 'prod_1')
    expect(checkFirewall).toHaveBeenCalledWith(env, 'user@example.com', 'prod_1')
    expect(inserts).toContainEqual({
      table: contacts,
      values: expect.objectContaining({ email: 'user@example.com' }),
    })
    expect(audit).toHaveBeenCalledWith(
      env,
      'api:client.access',
      'lead_magnet.downloaded',
      'lead_magnet',
      'lm_1',
      null,
      { email: 'user@example.com', slug: 'tenant-checklist' },
    )
  })

  it.each([
    ['non-string email', JSON.stringify({ email: 42 })],
    ['JSON null body', 'null'],
  ])('rejects invalid lead magnet download email values before product side effects: %s', async (_caseName, body) => {
    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body,
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'email must be a valid email address' })
    expect(checkSuppression).not.toHaveBeenCalled()
    expect(checkFirewall).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('rejects malformed lead magnet attribution fields before contact or token side effects', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [])
    queueSelect(sequence_runs, [activeRun])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({
          email: 'user@example.com',
          first_name: { bad: true },
          source: ['form'],
          utm: { campaign: 42 },
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_lead_magnet_download_body' })
    expect(checkSuppression).not.toHaveBeenCalled()
    expect(checkFirewall).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
    expect(env.SESSIONS.put).not.toHaveBeenCalled()
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('rejects lead magnet downloads when no asset is configured', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: null,
        asset_r2_key: null,
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'asset_not_configured',
      detail: 'Lead magnet does not have a Sequencer-hosted asset',
    })
    expect(inserts).toHaveLength(0)
    expect(env.SESSIONS.put).not.toHaveBeenCalled()
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('rejects lead magnet downloads when the configured asset bucket is unsupported', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'unknown-lead-magnets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'asset_bucket_not_configured',
      detail: 'Lead magnet asset bucket is not configured for this Worker',
    })
    expect(inserts).toHaveLength(0)
    expect(env.SESSIONS.put).not.toHaveBeenCalled()
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('rejects lead magnet downloads for inactive product associations before attribution or token creation', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'unsubscribed' },
    ])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Contact is not active for this product' })
    expect(inserts).toHaveLength(0)
    expect(env.SESSIONS.put).not.toHaveBeenCalled()
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('preserves lead magnet fulfillment enrollment when no run is active', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [])
    queueSelect(sequences, [
      { slug: 'fulfillment-sequence', product_id: 'prod_1', version: 3, is_active: true },
    ])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: expect.any(String),
      status: 'enrolled',
    })
    expect(inserts.some((call) => call.table === sequence_runs)).toBe(true)
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledOnce()
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('emits configured lead magnet conversion events to active same-product runs', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: null,
        conversion_event_name: 'tenant_checklist_downloaded',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [activeRun])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'USER@example.com', source: 'lead_magnet_form' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(inserts).toContainEqual({
      table: events,
      values: expect.objectContaining({
        provider: 'internal',
        type: 'tenant_checklist_downloaded',
        payload: expect.objectContaining({
          email: 'user@example.com',
          product: 'camaudit',
          lead_magnet_slug: 'tenant-checklist',
          lead_magnet_id: 'lm_1',
          source: 'lead_magnet_form',
        }),
      }),
    })
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledWith('run_oldest')
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
    await expect(env.__sequenceRunFetch.mock.calls[0][0].json()).resolves.toEqual({
      event: 'tenant_checklist_downloaded',
      properties: expect.objectContaining({
        lead_magnet_slug: 'tenant-checklist',
        lead_magnet_id: 'lm_1',
        source: 'lead_magnet_form',
      }),
    })
  })

  it('reports partial failure when a lead magnet conversion event cannot notify an active run', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: null,
        conversion_event_name: 'tenant_checklist_downloaded',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [activeRun])
    const env = baseEnv({
      SEQUENCE_RUN: {
        idFromName: vi.fn((id: string) => ({ id })),
        get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('failed', { status: 500 })) })),
      },
    })

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'conversion_event_delivery_failed',
      detail: 'Lead magnet asset is available, but conversion event delivery failed',
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: null,
      status: 'no_sequence',
      notified_runs: 0,
      failed_runs: ['run_oldest'],
    })
    expect(inserts).toContainEqual({
      table: events,
      values: expect.objectContaining({
        provider: 'internal',
        type: 'tenant_checklist_downloaded',
      }),
    })
    expect(env.SESSIONS.put).toHaveBeenCalledOnce()
  })

  it('does not cache lead magnet conversion delivery failures under the idempotency key', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      queueSelect(lead_magnets, [
        {
          id: 'lm_1',
          product_id: 'prod_1',
          slug: 'tenant-checklist',
          active: true,
          fulfillment_sequence_slug: null,
          conversion_event_name: 'tenant_checklist_downloaded',
          asset_r2_bucket: 'sequencer-assets',
          asset_r2_key: 'lead-magnets/tenant.pdf',
        },
      ])
      queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
      queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
      queueSelect(contact_products, [
        { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
      ])
      queueSelect(sequence_runs, [activeRun])
    }

    const kv = new Map<string, string>()
    const sequenceRunFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    const env = baseEnv({
      SESSIONS: {
        get: vi.fn(async (key: string) => kv.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kv.set(key, value)
        }),
        delete: vi.fn(),
      },
      SEQUENCE_RUN: {
        idFromName: vi.fn((id: string) => ({ id })),
        get: vi.fn(() => ({ fetch: sequenceRunFetch })),
      },
    })

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)
    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': 'client.access',
        'Idempotency-Key': 'tenant-user-1',
      },
      body: JSON.stringify({ email: 'user@example.com' }),
    }

    const first = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      request,
      env,
    )
    const second = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      request,
      env,
    )

    expect(first.status).toBe(207)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      ok: true,
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: null,
      status: 'no_sequence',
    })
    expect(sequenceRunFetch).toHaveBeenCalledTimes(2)
    expect(inserts.filter((call) => call.table === events)).toHaveLength(2)
  })

  it('starts lead magnet fulfillment when the only active run belongs to another product', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [otherProductActiveRun])
    queueSelect(sequences, [
      { slug: 'fulfillment-sequence', product_id: 'prod_1', version: 3, is_active: true },
    ])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: expect.any(String),
      status: 'enrolled',
    })
    expect(inserts).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        contact_id: 'contact_1',
        product_id: 'prod_1',
        sequence_slug: 'fulfillment-sequence',
      }),
    })
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledOnce()
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('delivers and enrolls with the winning contact when lead magnet contact creation races', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [])
    queueSelect(contacts, [{ id: 'contact_winner', email: 'user@example.com' }])
    queueSelect(contact_products, [])
    queueSelect(sequence_runs, [])
    queueSelect(sequences, [
      { slug: 'fulfillment-sequence', product_id: 'prod_1', version: 3, is_active: true },
    ])
    contactInsertError = new Error('D1_ERROR: UNIQUE constraint failed: contacts.email')
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(
      expect.objectContaining({
        ok: true,
        run_id: expect.any(String),
        status: 'enrolled',
      }),
    )
    expect(inserts).toContainEqual({
      table: contact_sources,
      values: expect.objectContaining({
        contact_id: 'contact_winner',
        product_id: 'prod_1',
      }),
    })
    expect(inserts).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        contact_id: 'contact_winner',
        product_id: 'prod_1',
      }),
    })
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('returns a partial failure when a configured lead magnet sequence belongs to another product', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [])
    queueSelect(sequences, [
      { slug: 'fulfillment-sequence', product_id: 'prod_2', version: 3, is_active: true },
    ])
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'fulfillment_failed',
      detail: 'Lead magnet asset is available, but fulfillment sequence start failed',
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: null,
      status: 'fulfillment_failed',
    })
    expect(inserts.some((call) => call.table === sequence_runs)).toBe(false)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
    expect(env.SESSIONS.put).toHaveBeenCalledOnce()
  })

  it('returns a partial failure with the lead magnet asset when fulfillment DO start fails', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(contact_products, [
      { contact_id: 'contact_1', product_id: 'prod_1', status: 'active' },
    ])
    queueSelect(sequence_runs, [])
    queueSelect(sequences, [
      { slug: 'fulfillment-sequence', product_id: 'prod_1', version: 3, is_active: true },
    ])
    const env = baseEnv({
      SEQUENCE_RUN: {
        idFromName: vi.fn((id: string) => ({ id })),
        get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('boom', { status: 500 })) })),
      },
    })

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'fulfillment_failed',
      detail: 'Lead magnet asset is available, but fulfillment sequence start failed',
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: expect.any(String),
      status: 'fulfillment_failed',
    })
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ status: 'errored' }),
      condition: expect.objectContaining({ column: sequence_runs.id }),
    })
    expect(env.SESSIONS.put).toHaveBeenCalledOnce()
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'lead_magnet.downloaded',
      'lead_magnet',
      'lm_1',
      null,
      { email: 'user@example.com', slug: 'tenant-checklist' },
    )
  })

  it('still returns the lead magnet asset when fulfillment enrollment loses the unique-index race', async () => {
    queueSelect(lead_magnets, [
      {
        id: 'lm_1',
        product_id: 'prod_1',
        slug: 'tenant-checklist',
        active: true,
        fulfillment_sequence_slug: 'fulfillment-sequence',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/tenant.pdf',
      },
    ])
    queueSelect(products, [{ id: 'prod_1', slug: 'camaudit' }])
    queueSelect(contacts, [{ id: 'contact_1', email: 'user@example.com' }])
    queueSelect(sequence_runs, [])
    queueSelect(sequences, [
      { slug: 'fulfillment-sequence', product_id: 'prod_1', version: 3, is_active: true },
    ])
    queueSelect(sequence_runs, [activeRun])
    sequenceRunInsertError = new Error(
      'D1_ERROR: UNIQUE constraint failed: idx_runs_one_running_per_contact_product',
    )
    const env = baseEnv()

    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    const app = new Hono()
    app.route('/api/v1/lead-magnets', leadMagnetsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant-checklist/download',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      asset_url: expect.stringMatching(
        /^https:\/\/sequencer\.ventoralabs\.com\/assets\/lead-magnets\/tenant-checklist\?token=/,
      ),
      run_id: 'run_oldest',
      status: 'already_running',
    })
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
    expect(env.SESSIONS.put).toHaveBeenCalledOnce()
  })
})
