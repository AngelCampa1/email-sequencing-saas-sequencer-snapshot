import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── lightweight table stubs ──────────────────────────────────────────────────
const lists = {
  __name: 'lists',
  id: 'lists.id',
  product_id: 'lists.product_id',
  slug: 'lists.slug',
  name: 'lists.name',
}
const list_members = {
  __name: 'list_members',
  id: 'list_members.id',
  list_id: 'list_members.list_id',
  contact_id: 'list_members.contact_id',
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
  status: 'contact_products.status',
}
const products = {
  __name: 'products',
  id: 'products.id',
  slug: 'products.slug',
}

// ── per-test state ────────────────────────────────────────────────────────────
type Condition = { op: string; column?: unknown; value?: unknown; conditions?: Condition[] }
type InsertCall = { table: { __name: string }; values: unknown }
const inserts: InsertCall[] = []
const conflictIgnoredInserts: InsertCall[] = []
const selectQueues = new Map<string, unknown[][]>()

function queueSelect(table: { __name: string }, rows: unknown[]) {
  const existing = selectQueues.get(table.__name) ?? []
  existing.push(rows)
  selectQueues.set(table.__name, existing)
}

// ── mocks ─────────────────────────────────────────────────────────────────────
const requireProductApiClientContext = vi.fn()
const checkSuppression = vi.fn()
const ensureListMembership = vi.fn()
const createOrLoadContactByEmail = vi.fn()
const audit = vi.fn()
const trackMetric = vi.fn()
const createLogger = vi.fn(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown): Condition => ({ op: 'eq', column, value }),
  and: (...conditions: Condition[]): Condition => ({ op: 'and', conditions }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: (table: { __name: string }) => {
        const builder = {
          where: () => builder,
          limit: async () => {
            const queued = selectQueues.get(table.__name) ?? []
            return queued.shift() ?? []
          },
        }
        return builder
      },
    })),
    insert: vi.fn((table: { __name: string }) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values })
        return {
          onConflictDoNothing: vi.fn(async () => {
            conflictIgnoredInserts.push({ table, values })
          }),
        }
      }),
    })),
  })),
  contacts,
  contact_products,
  products,
  lists,
  list_members,
}))

vi.mock('../lib/product-api-auth', () => ({ requireProductApiClientContext }))
vi.mock('../lib/suppression', () => ({ checkSuppression }))
vi.mock('../lib/lists', () => ({ ensureListMembership }))
vi.mock('../lib/contact-upsert', () => ({ createOrLoadContactByEmail }))
vi.mock('../lib/audit', () => ({ audit }))
vi.mock('../lib/observability', () => ({ createLogger, trackMetric }))

// ── helpers ───────────────────────────────────────────────────────────────────
function makeEnv() {
  return { DB: {}, SUPPRESSIONS: {}, ANALYTICS: {} }
}

function makeApiClient(productSlug = 'camaudit') {
  return { productSlug, clientId: 'camaudit.access', productId: 'prod_camaudit' }
}

const contact = { id: 'contact_1', email: 'user@example.com' }
const product = { id: 'prod_camaudit', slug: 'camaudit' }

// ── tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/v1/lists', () => {
  beforeEach(() => {
    inserts.length = 0
    conflictIgnoredInserts.length = 0
    selectQueues.clear()
    vi.clearAllMocks()
    createLogger.mockReturnValue({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    requireProductApiClientContext.mockResolvedValue(makeApiClient())
    checkSuppression.mockResolvedValue({ suppressed: false })
    ensureListMembership.mockResolvedValue({ list_id: 'list_1', member_id: 'member_1' })
    createOrLoadContactByEmail.mockResolvedValue({ contact })
  })

  it('returns 201 with list_slug and status added on happy path', async () => {
    queueSelect(products, [product])
    queueSelect(contacts, [contact])
    queueSelect(contact_products, [
      { contact_id: contact.id, product_id: product.id, status: 'active' },
    ])

    const { listsRoute } = await import('../routes/api/v1/lists')
    const app = (await import('hono')).Hono
    const hono = new app()
    hono.route('/api/v1/lists', listsRoute)

    const req = new Request('http://localhost/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', list_slug: 'camaudit-all' }),
    })
    const res = await hono.fetch(req, makeEnv())

    expect(res.status).toBe(201)
    const body = (await res.json()) as { list_slug: string; status: string }
    expect(body.list_slug).toBe('camaudit-all')
    expect(body.status).toBe('added')
    expect(ensureListMembership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ listSlug: 'camaudit-all', contactId: contact.id, source: 'api' }),
    )
  })

  it('returns 422 when contact is suppressed', async () => {
    queueSelect(products, [product])
    queueSelect(contacts, [contact])
    checkSuppression.mockResolvedValue({
      suppressed: true,
      scope: 'product',
      reason: 'unsubscribed',
    })

    const { listsRoute } = await import('../routes/api/v1/lists')
    const app = (await import('hono')).Hono
    const hono = new app()
    hono.route('/api/v1/lists', listsRoute)

    const req = new Request('http://localhost/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', list_slug: 'camaudit-all' }),
    })
    const res = await hono.fetch(req, makeEnv())

    expect(res.status).toBe(422)
    expect(ensureListMembership).not.toHaveBeenCalled()
  })

  it('returns 404 when the product is not found', async () => {
    queueSelect(products, []) // no product row

    const { listsRoute } = await import('../routes/api/v1/lists')
    const app = (await import('hono')).Hono
    const hono = new app()
    hono.route('/api/v1/lists', listsRoute)

    const req = new Request('http://localhost/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', list_slug: 'camaudit-all' }),
    })
    const res = await hono.fetch(req, makeEnv())

    expect(res.status).toBe(404)
    expect(ensureListMembership).not.toHaveBeenCalled()
  })

  it('creates the contact and the product association when neither exists', async () => {
    queueSelect(products, [product])
    queueSelect(contacts, []) // no existing contact -> createOrLoadContactByEmail
    queueSelect(contact_products, []) // no association -> insert

    const { listsRoute } = await import('../routes/api/v1/lists')
    const app = (await import('hono')).Hono
    const hono = new app()
    hono.route('/api/v1/lists', listsRoute)

    const req = new Request('http://localhost/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', list_slug: 'camaudit-all' }),
    })
    const res = await hono.fetch(req, makeEnv())

    expect(res.status).toBe(201)
    expect(createOrLoadContactByEmail).toHaveBeenCalled()
    // an association upsert was issued
    expect(conflictIgnoredInserts.some((i) => i.table.__name === 'contact_products')).toBe(true)
    expect(ensureListMembership).toHaveBeenCalled()
  })

  it('returns 422 when the contact_product association is not active', async () => {
    queueSelect(products, [product])
    queueSelect(contacts, [contact])
    queueSelect(contact_products, [
      { contact_id: contact.id, product_id: product.id, status: 'unsubscribed' },
    ])

    const { listsRoute } = await import('../routes/api/v1/lists')
    const app = (await import('hono')).Hono
    const hono = new app()
    hono.route('/api/v1/lists', listsRoute)

    const req = new Request('http://localhost/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', list_slug: 'camaudit-all' }),
    })
    const res = await hono.fetch(req, makeEnv())

    expect(res.status).toBe(422)
    expect(ensureListMembership).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid body', async () => {
    const { listsRoute } = await import('../routes/api/v1/lists')
    const app = (await import('hono')).Hono
    const hono = new app()
    hono.route('/api/v1/lists', listsRoute)

    const req = new Request('http://localhost/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-valid' }),
    })
    const res = await hono.fetch(req, makeEnv())

    expect(res.status).toBe(400)
  })
})
