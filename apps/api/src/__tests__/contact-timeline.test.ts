import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const products = {
  __name: 'products',
  id: 'products.id',
  slug: 'products.slug',
}
const api_tokens = {
  __name: 'api_tokens',
  access_service_token_id: 'api_tokens.access_service_token_id',
  product_id: 'api_tokens.product_id',
  revoked_at: 'api_tokens.revoked_at',
}
const sequences = {
  __name: 'sequences',
  slug: 'sequences.slug',
  product_id: 'sequences.product_id',
}
const sequence_runs = {
  __name: 'sequence_runs',
  contact_id: 'sequence_runs.contact_id',
}
const steps = {
  __name: 'steps',
  run_id: 'steps.run_id',
}
const messages = {
  __name: 'messages',
  contact_id: 'messages.contact_id',
  product_id: 'messages.product_id',
  resend_message_id: 'messages.resend_message_id',
}
const events = {
  __name: 'events',
  message_id: 'events.message_id',
  provider: 'events.provider',
}

const rows = new Map<string, unknown[]>()
const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')

type ContactTimelineResponse = {
  email: string
  first_name?: string | null
  last_name?: string | null
  properties?: Record<string, unknown> | null
  runs: Array<Record<string, unknown> & { steps: Array<Record<string, unknown>> }>
  messages: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  timeline: Array<{ kind: string; at: string }>
}

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  isNull: (column: unknown) => ({ op: 'isNull', column }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: (table: { __name: string }) => {
        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: async () => rows.get(table.__name) ?? [],
          then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(rows.get(table.__name) ?? []).then(resolve, reject),
        }
        return builder
      },
    })),
  })),
  api_tokens,
  contacts,
  contact_products,
  products,
  sequences,
  sequence_runs,
  steps,
  messages,
  events,
}))

function env() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    CF_ACCESS_TEAM_NAME: 'sequencer-test',
    CF_ACCESS_AUD: 'dashboard-aud',
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...binds: unknown[]) => ({
          all: vi.fn(async () => ({ results: rowsForSql(sql, binds) })),
        })),
        all: vi.fn(async () => ({ results: rowsForSql(sql, []) })),
      })),
    },
    ANALYTICS: { writeDataPoint: vi.fn() },
  }
}

function rowsForSql(sql: string, binds: unknown[]) {
  if (sql.includes('FROM seq_sequence_runs')) {
    const [contactId, productId] = binds
    return (rows.get('sequence_runs') ?? []).filter((row) => {
      const run = row as { contact_id: string; product_id: string }
      return run.contact_id === contactId && run.product_id === productId
    })
  }

  if (sql.includes('FROM seq_steps')) {
    const runIds = new Set(binds)
    return (rows.get('steps') ?? []).filter((row) => runIds.has((row as { run_id: string }).run_id))
  }

  if (sql.includes('FROM seq_messages')) {
    const [contactId, productId] = binds
    return (rows.get('messages') ?? []).filter((row) => {
      const message = row as { contact_id: string; product_id: string }
      return message.contact_id === contactId && message.product_id === productId
    })
  }

  if (sql.includes('message_id IN')) {
    const messageIds = new Set(binds)
    return (rows.get('events') ?? []).filter((row) => {
      const event = row as { provider: string; message_id: string | null }
      return (
        event.provider === 'resend' &&
        typeof event.message_id === 'string' &&
        messageIds.has(event.message_id)
      )
    })
  }

  if (sql.includes("provider = 'internal'")) {
    const [email, product] = binds
    return (rows.get('events') ?? []).filter((row) => {
      const event = row as { provider: string; payload: string }
      const payload = JSON.parse(event.payload) as { email?: string; product?: string }
      return event.provider === 'internal' && payload.email === email && payload.product === product
    })
  }

  return []
}

describe('product contact timeline API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.clear()
    jwtVerify.mockResolvedValue({ payload: { common_name: 'client-1.access' } })
    rows.set('api_tokens', [{ slug: 'camaudit' }])
    rows.set('contacts', [
      {
        id: 'contact_1',
        email: 'user@example.com',
        first_name: 'Uma',
        last_name: 'User',
        properties: { plan: 'trial' },
        created_at: '2026-05-19T10:00:00.000Z',
        updated_at: '2026-05-19T10:00:00.000Z',
      },
    ])
    rows.set('products', [
      {
        id: 'prod_camaudit',
        slug: 'camaudit',
        name: 'CAMAudit',
      },
    ])
    rows.set('contact_products', [
      {
        id: 'assoc_1',
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        first_name: 'Cama',
        last_name: 'Scoped',
        properties: { plan: 'camaudit' },
        status: 'active',
        created_at: '2026-05-19T10:01:00.000Z',
      },
    ])
    rows.set('sequences', [{ slug: 'camaudit-welcome', product_id: 'prod_camaudit' }])
    rows.set('sequence_runs', [
      {
        id: 'run_1',
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        sequence_slug: 'camaudit-welcome',
        sequence_version: 2,
        status: 'running',
        current_step_index: 1,
        variant_assignment: '{"variant_id":"control"}',
        started_at: '2026-05-19T10:02:00.000Z',
      },
      {
        id: 'run_other',
        contact_id: 'contact_1',
        product_id: 'prod_floriva_web',
        sequence_slug: 'floriva-web-welcome',
        sequence_version: 1,
        status: 'running',
        current_step_index: 0,
        variant_assignment: '{"variant_id":"other"}',
        started_at: '2026-05-19T10:03:00.000Z',
      },
    ])
    rows.set('steps', [
      {
        id: 'step_1',
        run_id: 'run_1',
        step_index: 0,
        template_slug: 'intro',
        status: 'sent',
        scheduled_for: '2026-05-19T10:02:00.000Z',
        sent_at: '2026-05-19T10:05:00.000Z',
        message_id: 'msg_1',
      },
      {
        id: 'step_other',
        run_id: 'run_other',
        step_index: 0,
        template_slug: 'other',
        status: 'sent',
        scheduled_for: '2026-05-19T10:03:00.000Z',
        sent_at: '2026-05-19T10:06:00.000Z',
        message_id: 'msg_other',
      },
    ])
    rows.set('messages', [
      {
        id: 'message_1',
        step_id: 'step_1',
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        resend_message_id: 'msg_1',
        subject: 'Welcome',
        from_email: 'founder@camaudit.io',
        sent_at: '2026-05-19T10:05:00.000Z',
      },
      {
        id: 'message_other',
        step_id: 'step_other',
        contact_id: 'contact_1',
        product_id: 'prod_floriva_web',
        resend_message_id: 'msg_other',
        subject: 'Other',
        from_email: 'support@floriva.app',
        sent_at: '2026-05-19T10:06:00.000Z',
      },
    ])
    rows.set('events', [
      ...Array.from({ length: 600 }, (_, index) => ({
        id: `internal_noise_${index}`,
        provider: 'internal',
        message_id: null,
        type: 'reply_received',
        payload: JSON.stringify({ email: `other-${index}@example.com`, product: 'floriva-web' }),
        received_at: `2026-05-19T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })),
      {
        id: 'event_1',
        provider: 'resend',
        message_id: 'msg_1',
        type: 'email.opened',
        payload: JSON.stringify({ email_id: 'msg_1' }),
        received_at: '2026-05-19T10:07:00.000Z',
      },
      {
        id: 'event_collision',
        provider: 'instantly',
        message_id: 'msg_1',
        type: 'reply_received',
        payload: JSON.stringify({ email_id: 'msg_1' }),
        received_at: '2026-05-19T10:07:30.000Z',
      },
      {
        id: 'event_2',
        provider: 'internal',
        message_id: null,
        type: 'reply_received',
        payload: JSON.stringify({ email: 'user@example.com', product: 'camaudit' }),
        received_at: '2026-05-19T10:08:00.000Z',
      },
      {
        id: 'event_other',
        provider: 'resend',
        message_id: 'msg_other',
        type: 'email.opened',
        payload: JSON.stringify({ email_id: 'msg_other' }),
        received_at: '2026-05-19T10:09:00.000Z',
      },
    ])
  })

  it('returns a product-scoped contact timeline', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts/User%40Example.com',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      env(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as ContactTimelineResponse
    expect(body.email).toBe('user@example.com')
    expect(body).toMatchObject({
      first_name: 'Cama',
      last_name: 'Scoped',
      properties: { plan: 'camaudit' },
    })
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0]).toMatchObject({
      id: 'run_1',
      sequence_slug: 'camaudit-welcome',
      variant_assignment: { variant_id: 'control' },
      steps: [
        expect.objectContaining({
          id: 'step_1',
          status: 'sent',
          message: expect.objectContaining({ id: 'message_1', resend_message_id: 'msg_1' }),
          events: [expect.objectContaining({ id: 'event_1', type: 'email.opened' })],
        }),
      ],
    })
    expect(body.messages).toEqual([
      expect.objectContaining({ id: 'message_1', resend_message_id: 'msg_1' }),
    ])
    expect(body.events).toEqual([
      expect.objectContaining({
        id: 'event_1',
        type: 'email.opened',
        payload: { email_id: 'msg_1' },
      }),
      expect.objectContaining({
        id: 'event_2',
        type: 'reply_received',
        payload: { email: 'user@example.com', product: 'camaudit' },
      }),
    ])
    expect(
      body.timeline.map((entry: { kind: string; at: string }) => [entry.kind, entry.at]),
    ).toEqual([
      ['run.started', '2026-05-19T10:02:00.000Z'],
      ['step.sent', '2026-05-19T10:05:00.000Z'],
      ['message.sent', '2026-05-19T10:05:00.000Z'],
      ['event.email.opened', '2026-05-19T10:07:00.000Z'],
      ['event.reply_received', '2026-05-19T10:08:00.000Z'],
    ])
  })

  it('hides globally-known contacts without a same-product membership', async () => {
    rows.set('contact_products', [])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts/user%40example.com',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      env(),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Contact not found' })
  })

  it('rejects malformed encoded email path params as a bad request', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts/%E0%A4%A',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      env(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid email parameter' })
  })

  it('rejects non-email contact path params before lookup', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts/not-an-email',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      env(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid email parameter' })
  })

  it('does not include same-email timeline records from another product', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts/user%40example.com',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      env(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as ContactTimelineResponse
    expect(JSON.stringify(body)).not.toContain('run_other')
    expect(JSON.stringify(body)).not.toContain('message_other')
    expect(JSON.stringify(body)).not.toContain('event_other')
    expect(JSON.stringify(body)).not.toContain('event_collision')
    expect(JSON.stringify(body)).not.toContain('floriva-web')
  })

  it('does not expose global contact profile fields from another product', async () => {
    rows.set('contacts', [
      {
        id: 'contact_1',
        email: 'user@example.com',
        first_name: 'Other',
        last_name: 'Product',
        properties: { plan: 'other-product-secret' },
        created_at: '2026-05-19T10:00:00.000Z',
        updated_at: '2026-05-19T10:00:00.000Z',
      },
    ])
    rows.set('contact_products', [
      {
        id: 'assoc_1',
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        status: 'active',
        created_at: '2026-05-19T10:01:00.000Z',
      },
    ])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts/user%40example.com',
      {
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      env(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      first_name: null,
      last_name: null,
      properties: null,
    })
    expect(JSON.stringify(body)).not.toContain('other-product-secret')
  })
})
