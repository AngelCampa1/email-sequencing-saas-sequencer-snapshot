import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireProductApiClient = vi.fn()
const requireProductApiClientContext = vi.fn()
const addSuppression = vi.fn()
const audit = vi.fn()
const productRows: Array<{ id: string }> = []
const contactRows: Array<{ id: string }> = []
const activeRunRows: Array<{ id: string }> = []
const doFetch = vi.fn()
let selectCall = 0

vi.mock('../lib/product-api-auth', () => ({
  requireProductApiClient,
  requireProductApiClientContext,
}))
vi.mock('../lib/suppression', () => ({ addSuppression }))
vi.mock('../lib/audit', () => ({ audit }))
vi.mock('../lib/observability', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}))

vi.mock('@sequencer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sequencer/db')>()
  return {
    ...actual,
    createDb: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table === actual.sequence_runs) {
            return {
              where: vi.fn(async () => activeRunRows),
            }
          }
          return {
            where: vi.fn(() => ({
              limit: vi.fn(async () => {
                selectCall += 1
                return selectCall === 1 ? productRows : contactRows
              }),
            })),
          }
        }),
      })),
    })),
  }
})

function baseEnv() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    UNSUBSCRIBE_SIGNING_SECRET: 'test-unsubscribe-signing-secret',
    DB: {},
    ANALYTICS: { writeDataPoint: vi.fn() },
    SUPPRESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    SEQUENCE_RUN: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => ({ fetch: doFetch })),
    },
  }
}

async function signedUnsubscribePath(
  path = '/api/v1/unsubscribe',
  email = 'Tenant@Example.com',
  product = 'camaudit',
) {
  const { buildSignedUnsubscribeUrl } = await import('../lib/unsubscribe-token')
  const url = await buildSignedUnsubscribeUrl({
    baseUrl: `https://sequencer.ventoralabs.com${path}`,
    email,
    product,
    secret: 'test-unsubscribe-signing-secret',
  })
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}

describe('unsubscribe route scope safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    productRows.length = 0
    contactRows.length = 0
    activeRunRows.length = 0
    selectCall = 0
    requireProductApiClient.mockResolvedValue('camaudit')
    requireProductApiClientContext.mockResolvedValue({
      productSlug: 'camaudit',
      clientId: 'client.access',
    })
    addSuppression.mockResolvedValue(undefined)
    audit.mockResolvedValue(undefined)
    doFetch.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('rejects product API attempts to create global suppressions', async () => {
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'tenant@example.com', product: 'camaudit', scope: 'global' }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'global_unsubscribe_forbidden' })
    expect(addSuppression).not.toHaveBeenCalled()
  })

  it('requires a product for product API unsubscribes', async () => {
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'tenant@example.com' }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'product_required' })
    expect(addSuppression).not.toHaveBeenCalled()
  })

  it('audits product API unsubscribes with the verified client id', async () => {
    productRows.push({ id: 'prod_camaudit' })
    requireProductApiClientContext.mockResolvedValue({
      productSlug: 'camaudit',
      clientId: 'verified-client.access',
    })
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'spoofed-client.access',
        },
        body: JSON.stringify({
          email: 'tenant@example.com',
          product: 'camaudit',
          scope: 'product',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      'api:verified-client.access',
      'contact.unsubscribed',
      'suppression',
      null,
      null,
      { email: 'tenant@example.com', scope: 'product', product: 'camaudit' },
    )
  })

  it('defaults blank product API unsubscribe reasons before storing suppressions', async () => {
    productRows.push({ id: 'prod_camaudit' })
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({
          email: 'tenant@example.com',
          product: 'camaudit',
          scope: 'product',
          reason: '   ',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'tenant@example.com',
      'product',
      'prod_camaudit',
      'unsubscribed',
      'manual',
    )
  })

  it('notifies active product sequence runs when the product API unsubscribes a contact', async () => {
    productRows.push({ id: 'prod_camaudit' })
    contactRows.push({ id: 'contact_1' })
    activeRunRows.push({ id: 'run_1' }, { id: 'run_2' })
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({
          email: 'Tenant@Example.com',
          product: 'camaudit',
          scope: 'product',
        }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      email: 'tenant@example.com',
      notified_runs: 2,
    })
    expect(doFetch).toHaveBeenCalledTimes(2)
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'unsubscribed' })
  })

  it('reports product API unsubscribe delivery failures after storing the suppression', async () => {
    productRows.push({ id: 'prod_camaudit' })
    contactRows.push({ id: 'contact_1' })
    activeRunRows.push({ id: 'run_failed' })
    doFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({
          email: 'tenant@example.com',
          product: 'camaudit',
          scope: 'product',
        }),
      },
      baseEnv(),
    )

    expect(addSuppression).toHaveBeenCalled()
    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'unsubscribe_delivery_failed',
      email: 'tenant@example.com',
      scope: 'product',
      notified_runs: 0,
      failed_runs: ['run_failed'],
    })
  })

  it('rejects one-click unsubscribe links without a known product', async () => {
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      await signedUnsubscribePath('/api/v1/unsubscribe', 'tenant@example.com', 'camaudit'),
      {},
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Unknown product')
    expect(addSuppression).not.toHaveBeenCalled()
  })

  it('stores one-click unsubscribes as product-scoped when the product is known', async () => {
    productRows.push({ id: 'prod_camaudit' })
    contactRows.push({ id: 'contact_1' })
    activeRunRows.push({ id: 'run_1' })
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      await signedUnsubscribePath('/api/v1/unsubscribe', 'Tenant@Example.com', 'camaudit'),
      {},
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'tenant@example.com',
      'product',
      'prod_camaudit',
      'one_click_unsubscribe',
      'webhook',
    )
    expect(doFetch).toHaveBeenCalledTimes(1)
    await expect(doFetch.mock.calls[0][0].json()).resolves.toEqual({ event: 'unsubscribed' })
  })

  it('normalizes one-click unsubscribe email and product query params before side effects', async () => {
    productRows.push({ id: 'prod_camaudit' })
    contactRows.push({ id: 'contact_1' })
    activeRunRows.push({ id: 'run_1' })
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      await signedUnsubscribePath('/api/v1/unsubscribe', ' Tenant@Example.com ', ' CAMAUDIT '),
      {},
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'tenant@example.com',
      'product',
      'prod_camaudit',
      'one_click_unsubscribe',
      'webhook',
    )
    expect(doFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects forged one-click unsubscribe links before side effects', async () => {
    productRows.push({ id: 'prod_camaudit' })
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe?email=tenant%40example.com&product=camaudit',
      {},
      baseEnv(),
    )

    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Invalid unsubscribe link')
    expect(addSuppression).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('rejects malformed one-click unsubscribe emails before side effects', async () => {
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.route('/api/v1/unsubscribe', unsubscribeRoute)

    const res = await app.request(
      '/api/v1/unsubscribe?email=not-an-email&product=camaudit',
      {},
      baseEnv(),
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid email parameter')
    expect(addSuppression).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('supports the public unsubscribe alias used in email footers', async () => {
    productRows.push({ id: 'prod_camaudit' })
    const { oneClickUnsubscribe } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.get('/unsubscribe', oneClickUnsubscribe)

    const res = await app.request(
      await signedUnsubscribePath('/unsubscribe', 'Tenant@Example.com', 'camaudit'),
      {},
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(addSuppression).toHaveBeenCalledWith(
      expect.anything(),
      'tenant@example.com',
      'product',
      'prod_camaudit',
      'one_click_unsubscribe',
      'webhook',
    )
  })

  it('does not expose the authenticated POST handler on the public unsubscribe alias', async () => {
    const { oneClickUnsubscribe } = await import('../routes/api/v1/unsubscribe')
    const app = new Hono()
    app.get('/unsubscribe', oneClickUnsubscribe)

    const res = await app.request(
      '/unsubscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client.access' },
        body: JSON.stringify({ email: 'tenant@example.com', product: 'camaudit' }),
      },
      baseEnv(),
    )

    expect(res.status).toBe(404)
    expect(requireProductApiClient).not.toHaveBeenCalled()
    expect(addSuppression).not.toHaveBeenCalled()
  })
})
