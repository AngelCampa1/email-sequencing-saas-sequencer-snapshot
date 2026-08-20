import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkSuppression = vi.fn()
const checkFirewall = vi.fn()
const audit = vi.fn()
const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
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
const products = {
  __name: 'products',
  id: 'products.id',
  slug: 'products.slug',
}

const rows = new Map<string, unknown[]>()
const inserts: Array<{ table: { __name: string }; values: Record<string, unknown> }> = []
const conflictIgnoredInserts: Array<{
  table: { __name: string }
  values: Record<string, unknown>
}> = []
const updates: Array<{ table: { __name: string }; values: Record<string, unknown> }> = []
let contactInsertError: Error | null = null
let contactInsertRaceWinner: Record<string, unknown> | null = null

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: (table: { __name: string }) => {
        const builder = {
          where: () => builder,
          limit: async () => rows.get(table.__name) ?? [],
        }
        return builder
      },
    })),
    insert: vi.fn((table: { __name: string }) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values })
        if (table.__name === 'contacts') {
          if (contactInsertError) {
            const error = contactInsertError
            contactInsertError = null
            if (contactInsertRaceWinner) rows.set('contacts', [contactInsertRaceWinner])
            throw error
          }
          rows.set('contacts', [values])
        }
        return {
          onConflictDoNothing: vi.fn(async () => {
            conflictIgnoredInserts.push({ table, values })
          }),
        }
      }),
    })),
    update: vi.fn((table: { __name: string }) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values })
        return { where: vi.fn(async () => undefined) }
      }),
    })),
  })),
  contacts,
  contact_products,
  products,
}))

vi.mock('../lib/product-api-auth', () => ({
  requireProductApiClientContext: vi.fn(async () => ({
    productSlug: 'camaudit',
    clientId: 'client.access',
  })),
}))
vi.mock('../lib/suppression', () => ({ checkSuppression }))
vi.mock('../lib/firewall', () => ({ checkFirewall }))
vi.mock('../lib/audit', () => ({ audit }))
vi.mock('../lib/observability', () => ({ createLogger: vi.fn(() => logger) }))

function env() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    DB: {},
    ANALYTICS: { writeDataPoint: vi.fn() },
  }
}

describe('contact upsert product safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.clear()
    inserts.length = 0
    conflictIgnoredInserts.length = 0
    updates.length = 0
    contactInsertError = null
    contactInsertRaceWinner = null
    rows.set('products', [{ id: 'prod_camaudit', slug: 'camaudit' }])
    rows.set('contacts', [])
    rows.set('contact_products', [])
    checkSuppression.mockResolvedValue({ suppressed: false })
    checkFirewall.mockResolvedValue({ blocked: false })
  })

  it('rejects suppressed contacts before creating a contact or product membership', async () => {
    checkSuppression.mockResolvedValue({
      suppressed: true,
      scope: 'product',
      reason: 'unsubscribed',
    })
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'User@Example.com', product: 'camaudit' }),
      },
      env(),
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Contact is suppressed', scope: 'product' })
    expect(checkSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'prod_camaudit',
    )
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(audit).not.toHaveBeenCalled()
  })

  it('rejects firewall-blocked contacts before creating a product membership', async () => {
    checkFirewall.mockResolvedValue({
      blocked: true,
      reason: 'Already associated with firewall partner floriva-web',
    })
    rows.set('contacts', [{ id: 'contact_1', email: 'user@example.com' }])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', product: 'camaudit' }),
      },
      env(),
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'firewall_block',
      detail: 'Already associated with firewall partner floriva-web',
    })
    expect(checkFirewall).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'prod_camaudit',
    )
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      'api:client.access',
      'contact.blocked',
      'contact',
      null,
      null,
      {
        email: 'user@example.com',
        product: 'camaudit',
        reason: 'firewall',
      },
    )
  })

  it('rejects inactive product memberships before updating the contact', async () => {
    rows.set('contacts', [{ id: 'contact_1', email: 'user@example.com' }])
    rows.set('contact_products', [
      {
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        status: 'unsubscribed',
      },
    ])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          product: 'camaudit',
          first_name: 'Updated',
        }),
      },
      env(),
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Contact is not active for this product' })
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(audit).not.toHaveBeenCalled()
  })

  it('ignores duplicate membership races when associating an existing active contact', async () => {
    rows.set('contacts', [{ id: 'contact_1', email: 'user@example.com' }])
    rows.set('contact_products', [])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          product: 'camaudit',
          first_name: 'Updated',
        }),
      },
      env(),
    )

    expect(res.status).toBe(200)
    expect(conflictIgnoredInserts).toContainEqual({
      table: contact_products,
      values: {
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        first_name: 'Updated',
      },
    })
  })

  it('recovers when a concurrent request creates the contact first', async () => {
    rows.set('contacts', [])
    contactInsertError = new Error('D1_ERROR: UNIQUE constraint failed: seq_contacts.email')
    contactInsertRaceWinner = { id: 'contact_winner', email: 'user@example.com' }
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          product: 'camaudit',
          first_name: 'Race',
        }),
      },
      env(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'contact_winner',
      email: 'user@example.com',
      is_new: false,
    })
    expect(conflictIgnoredInserts).toContainEqual({
      table: contact_products,
      values: {
        contact_id: 'contact_winner',
        product_id: 'prod_camaudit',
        first_name: 'Race',
      },
    })
  })

  it('clears existing contact names when blank name fields are provided', async () => {
    rows.set('contacts', [
      {
        id: 'contact_1',
        email: 'user@example.com',
        first_name: 'Stale',
        last_name: 'Name',
      },
    ])
    rows.set('contact_products', [
      {
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        status: 'active',
      },
    ])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          product: 'camaudit',
          first_name: '',
          last_name: '   ',
        }),
      },
      env(),
    )

    expect(res.status).toBe(200)
    expect(updates).toContainEqual({
      table: contact_products,
      values: {
        updated_at: expect.any(String),
        first_name: null,
        last_name: null,
      },
    })
  })

  it('leaves existing contact names unchanged when name fields are omitted', async () => {
    rows.set('contacts', [
      {
        id: 'contact_1',
        email: 'user@example.com',
        first_name: 'Existing',
        last_name: 'Person',
      },
    ])
    rows.set('contact_products', [
      {
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        status: 'active',
      },
    ])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          product: 'camaudit',
        }),
      },
      env(),
    )

    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      table: contacts,
      values: {
        updated_at: expect.any(String),
      },
    })
  })

  it('stores blank new contact names as null', async () => {
    rows.set('contacts', [])
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@example.com',
          product: 'camaudit',
          first_name: '  ',
          last_name: '',
        }),
      },
      env(),
    )

    expect(res.status).toBe(201)
    expect(inserts).toContainEqual({
      table: contacts,
      values: {
        id: expect.any(String),
        email: 'new@example.com',
        first_name: null,
        last_name: null,
        properties: undefined,
      },
    })
  })
})
