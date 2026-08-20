import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../types'

let mappedProductSlug: string | null = null
let dbFailure: Error | null = null
const jwtVerify = vi.fn()
const createRemoteJWKSet = vi.fn(() => 'jwks')
const rateLimitMiddleware = vi.fn(async () => ({ allowed: true, remaining: 999, resetAt: 123 }))

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}))

vi.mock('../middleware/rate-limit', () => ({
  rateLimitMiddleware,
}))

vi.mock('@sequencer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sequencer/db')>()
  return {
    ...actual,
    createDb: vi.fn(() => {
      if (dbFailure) throw dbFailure
      return {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(() => (mappedProductSlug ? [{ slug: mappedProductSlug }] : [])),
              })),
            })),
          })),
        })),
      }
    }),
  }
})

function baseEnv() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    CF_ACCESS_TEAM_NAME: 'sequencer-test',
    CF_ACCESS_AUD: 'dashboard-aud',
    DB: {},
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
  }
}

describe('product API authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mappedProductSlug = null
    dbFailure = null
    jwtVerify.mockResolvedValue({ payload: { common_name: 'client-1.access' } })
    rateLimitMiddleware.mockResolvedValue({ allowed: true, remaining: 999, resetAt: 123 })
  })

  it('fails closed when the verified client id is missing', async () => {
    const { requireClientProductSlug } = await import('../lib/client-product')

    await expect(requireClientProductSlug(baseEnv() as Env, undefined)).rejects.toMatchObject({
      code: 'missing_client_id',
    })
  })

  it('returns the mapped product through the product-only auth helper', async () => {
    mappedProductSlug = 'camaudit'
    const { requireProductApiClient } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.get('/probe', async (c) => {
      const product = await requireProductApiClient(c)
      if (product instanceof Response) return product
      return c.text(product)
    })

    const authenticated = await app.request(
      '/probe',
      { headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' } },
      baseEnv(),
    )
    expect(authenticated.status).toBe(200)
    expect(await authenticated.text()).toBe('camaudit')

    const unauthenticated = await app.request('/probe', {}, baseEnv())
    expect(unauthenticated.status).toBe(401)
  })

  it('accepts a valid Access service_token_id claim when common_name is absent', async () => {
    mappedProductSlug = 'floriva-web'
    jwtVerify.mockResolvedValueOnce({ payload: { service_token_id: 'client-2.access' } })
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.get('/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/probe',
      { headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' } },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      productSlug: 'floriva-web',
      clientId: 'client-2.access',
    })
  })

  it('does not hide unexpected product mapping failures', async () => {
    dbFailure = new Error('D1 unavailable')
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.onError((error, c) => c.text(error.message, 503))
    app.get('/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/probe',
      { headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' } },
      baseEnv(),
    )

    expect(res.status).toBe(503)
    expect(await res.text()).toBe('D1 unavailable')
  })

  it('rejects missing Access JWT before request validation', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      { method: 'POST', body: '{bad json', headers: { 'Content-Type': 'application/json' } },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
  })

  it('rejects unmapped service-token client IDs', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', product: 'camaudit' }),
        headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
    expect(jwtVerify).toHaveBeenCalled()
  })

  it('rejects spoofed service-token client IDs without a valid Access JWT', async () => {
    mappedProductSlug = 'camaudit'
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', product: 'camaudit' }),
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client-1' },
      },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('rejects production service-token client ids without a verified Access JWT', async () => {
    mappedProductSlug = 'camaudit'
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      'https://sequencer.ventoralabs.com/api/v1/contacts',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', product: 'floriva-web' }),
        headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'client-1.access' },
      },
      { ...baseEnv(), ENVIRONMENT: 'production' },
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated contact timeline reads', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request('/api/v1/contacts/a%40example.com', {}, baseEnv())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
  })

  it('rejects mapped service-token clients for the wrong product', async () => {
    mappedProductSlug = 'floriva-web'
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    const app = new Hono()
    app.route('/api/v1/contacts', contactsRoute)

    const res = await app.request(
      '/api/v1/contacts',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', product: 'camaudit' }),
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'spoofed-camaudit-client',
          'Cf-Access-Jwt-Assertion': 'valid.jwt',
        },
      },
      baseEnv(),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'forbidden_product',
      detail: 'Token is not authorized for this product',
    })
    expect(jwtVerify).toHaveBeenCalledWith(
      'valid.jwt',
      'jwks',
      expect.objectContaining({
        audience: 'dashboard-aud',
        issuer: 'https://sequencer-test.cloudflareaccess.com',
      }),
    )
  })

  it('rate limits with the verified Access service-token client id', async () => {
    mappedProductSlug = 'floriva-web'
    const mod = await import('../index')

    const res = await mod.default.fetch(
      new Request('https://sequencer.test/api/v1/contacts', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', product: 'camaudit' }),
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'spoofed-camaudit-client',
          'Cf-Access-Jwt-Assertion': 'valid.jwt',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )

    expect(res.status).toBe(403)
    expect(rateLimitMiddleware).toHaveBeenCalledWith(
      expect.anything(),
      'client-1.access',
      'contacts',
    )
  })

  it('does not require product API auth for tokenized legacy lead magnet asset links', async () => {
    const mod = await import('../index')
    const get = vi.fn(async () => null)

    const res = await mod.default.fetch(
      new Request(
        'https://sequencer.test/api/v1/lead-magnets/foo/asset?token=expired-token',
      ) as never,
      {
        ...baseEnv(),
        SESSIONS: {
          get,
          put: vi.fn(),
          delete: vi.fn(),
        },
      } as never,
      {} as never,
    )

    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'asset token not found or expired' })
    expect(rateLimitMiddleware).not.toHaveBeenCalled()
    expect(jwtVerify).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith('lead_magnet_asset:expired-token')
  })

  it('exposes the verified service-token client id for product API audit actors', async () => {
    mappedProductSlug = 'camaudit'
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.post('/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/probe',
      {
        method: 'POST',
        headers: {
          'CF-Access-Client-Id': 'spoofed-camaudit-client',
          'Cf-Access-Jwt-Assertion': 'valid.jwt',
        },
      },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      productSlug: 'camaudit',
      clientId: 'client-1.access',
    })
  })

  it('prefers a verified Access common_name over a malformed service_token_id claim', async () => {
    mappedProductSlug = 'camaudit'
    jwtVerify.mockResolvedValueOnce({
      payload: {
        service_token_id: 'not-a-client-id',
        common_name: 'client-1.access',
      },
    })
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.post('/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/probe',
      {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      productSlug: 'camaudit',
      clientId: 'client-1.access',
    })
  })

  it('rejects malformed service_token_id claims when no Access client common_name is present', async () => {
    mappedProductSlug = 'camaudit'
    jwtVerify.mockResolvedValueOnce({ payload: { service_token_id: 'not-a-client-id' } })
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.post('/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/probe',
      {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
  })

  it('rejects invalid Access JWTs before touching rate limit buckets', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('bad signature'))
    const mod = await import('../index')

    const res = await mod.default.fetch(
      new Request('https://sequencer.test/api/v1/contacts', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', product: 'camaudit' }),
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'spoofed-camaudit-client',
          'Cf-Access-Jwt-Assertion': 'bad.jwt',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )

    expect(res.status).toBe(401)
    expect(rateLimitMiddleware).not.toHaveBeenCalled()
  })

  it('rejects the retired GrantPipe shared-secret client path', async () => {
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.post('/api/client/v1/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/api/client/v1/probe',
      {
        method: 'POST',
        headers: {
          'X-Sequencer-Product': 'grantpipe',
          'X-Sequencer-Client-Secret': 'grantpipe-secret',
        },
      },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('rejects retired products even when an Access token row still maps to them', async () => {
    mappedProductSlug = 'grantpipe'
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.post('/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/probe',
      {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' },
      },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
  })

  it('rejects the shared-secret client path when the secret is wrong', async () => {
    const { requireProductApiClientContext } = await import('../lib/product-api-auth')
    const app = new Hono<{ Bindings: Env }>()
    app.post('/api/client/v1/probe', async (c) => {
      const client = await requireProductApiClientContext(c)
      if (client instanceof Response) return client
      return c.json(client)
    })

    const res = await app.request(
      '/api/client/v1/probe',
      {
        method: 'POST',
        headers: {
          'X-Sequencer-Product': 'grantpipe',
          'X-Sequencer-Client-Secret': 'wrong-secret',
        },
      },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_authenticated' })
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('rate limits failed shared-secret product API auth by product and caller IP', async () => {
    const mod = await import('../index')

    const res = await mod.default.fetch(
      new Request('https://sequencer.test/api/client/v1/contacts', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'X-Sequencer-Product': 'grantpipe',
          'X-Sequencer-Client-Secret': 'wrong-secret',
          'CF-Connecting-IP': '203.0.113.10',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )

    expect(res.status).toBe(401)
    expect(rateLimitMiddleware).toHaveBeenCalledWith(
      expect.anything(),
      'failed-auth:grantpipe:203.0.113.10',
      'auth-fail',
    )
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('returns 429 when failed shared-secret auth exceeds the auth-fail limit', async () => {
    rateLimitMiddleware.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 123000 })
    const mod = await import('../index')

    const res = await mod.default.fetch(
      new Request('https://sequencer.test/api/client/v1/events', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'X-Sequencer-Product': 'grantpipe',
          'X-Sequencer-Client-Secret': 'wrong-secret',
          'CF-Connecting-IP': '203.0.113.10',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })

  it('allows browser product clients to send event idempotency keys through CORS preflight', async () => {
    const mod = await import('../index')

    const res = await mod.default.fetch(
      new Request('https://sequencer.test/api/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://sequencer.ventoralabs.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'Content-Type, CF-Access-Client-Id, CF-Access-Client-Secret, Idempotency-Key',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('Idempotency-Key')
  })

  it('allows credentialed dashboard CORS preflights for /me and internal API routes', async () => {
    const mod = await import('../index')

    const meRes = await mod.default.fetch(
      new Request('https://sequencer.test/me', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://sequencer.ventoralabs.com',
          'Access-Control-Request-Method': 'GET',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )
    const internalRes = await mod.default.fetch(
      new Request('https://sequencer.test/api/internal/contacts', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://sequencer.ventoralabs.com',
          'Access-Control-Request-Method': 'GET',
        },
      }) as never,
      baseEnv() as never,
      {} as never,
    )

    expect(meRes.status).toBe(204)
    expect(meRes.headers.get('access-control-allow-credentials')).toBe('true')
    expect(internalRes.status).toBe(204)
    expect(internalRes.headers.get('access-control-allow-credentials')).toBe('true')
  })
})

describe('/me Access authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jwtVerify.mockResolvedValue({ payload: { email: 'operator@example.com' } })
  })

  it('rejects spoofed Access email headers without a valid JWT', async () => {
    const { meRoute } = await import('../routes/me')
    const app = new Hono()
    app.route('/me', meRoute)

    const res = await app.request(
      '/me',
      { headers: { 'Cf-Access-Authenticated-User-Email': 'operator@example.com' } },
      baseEnv(),
    )

    expect(res.status).toBe(401)
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('returns the verified Access JWT email', async () => {
    const { meRoute } = await import('../routes/me')
    const app = new Hono()
    app.route('/me', meRoute)

    const res = await app.request(
      '/me',
      { headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' } },
      baseEnv(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'operator@example.com', authenticated: true })
    expect(jwtVerify).toHaveBeenCalledWith(
      'valid.jwt',
      'jwks',
      expect.objectContaining({
        audience: 'dashboard-aud',
        issuer: 'https://sequencer-test.cloudflareaccess.com',
      }),
    )
  })

  it('rejects verified Access users outside the dashboard allowlist', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { email: 'outsider@example.com' } })
    const { meRoute } = await import('../routes/me')
    const app = new Hono()
    app.route('/me', meRoute)

    const res = await app.request(
      '/me',
      { headers: { 'Cf-Access-Jwt-Assertion': 'valid.jwt' } },
      baseEnv(),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })
})
