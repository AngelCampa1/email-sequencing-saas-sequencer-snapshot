import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addSuppression,
  apiFetch,
  apiFetchText,
  apiUrl,
  createApiToken,
  createContact,
  createLeadMagnet,
  createProduct,
  createSequence,
  deleteContact,
  deleteLeadMagnet,
  deleteProduct,
  deleteSequence,
  getApiTokens,
  getAuditLog,
  getContactDetail,
  getContacts,
  getDeliverability,
  getLeadMagnets,
  getMe,
  getOverview,
  getProducts,
  getSequences,
  getSuppressions,
  getTemplates,
  joinApiUrl,
  removeSuppression,
  revokeApiToken,
  updateContact,
  updateInstantlyCampaign,
  updateLeadMagnet,
  updateProduct,
  updateSequence,
} from './api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes API detail text in thrown errors and preserves status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'forbidden_product',
              detail: 'Token is not authorized for this product',
            }),
            { status: 403 },
          ),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'forbidden_product: Token is not authorized for this product',
      status: 403,
    })
  })

  it('includes flattened validation details when the API returns them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Invalid request',
              details: {
                fieldErrors: {
                  email: ['Invalid email address'],
                  sequence_slug: ['Required'],
                },
              },
            }),
            { status: 400 },
          ),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Invalid request: email: Invalid email address; sequence_slug: Required',
      status: 400,
    })
  })

  it('fetches text responses with credentials for preview HTML', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('<strong>Preview</strong>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetchText('/api/internal/templates/example/preview')).resolves.toBe(
      '<strong>Preview</strong>',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/templates/example/preview', {
      credentials: 'include',
      headers: {},
    })
  })

  it('surfaces JSON preview endpoint errors for text requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Template not found',
              slug: 'missing/template',
            }),
            { status: 404 },
          ),
      ),
    )

    await expect(
      apiFetchText('/api/internal/templates/missing%2Ftemplate/preview'),
    ).rejects.toMatchObject({
      message: 'Template not found',
      status: 404,
    })
  })

  it('requests scoped suppression lists when a dashboard scope is provided', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([])))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSuppressions({ scope: 'product' })).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/suppressions?scope=product',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('getSuppressions appends q, limit, and offset params', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getSuppressions({ scope: 'global', q: 'a@b.com', limit: 25, offset: 50 })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/suppressions?scope=global&q=a%40b.com&limit=25&offset=50',
      expect.anything(),
    )
  })

  it('returns audit log pagination metadata from the internal API', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entries: [],
            has_next: false,
          }),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuditLog(2)).resolves.toEqual({ entries: [], has_next: false })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/audit?page=2',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('joins configured API bases without introducing duplicate slashes', () => {
    expect(joinApiUrl('https://sequencer.example.com/', '/api/internal/products')).toBe(
      'https://sequencer.example.com/api/internal/products',
    )
    expect(joinApiUrl('https://sequencer.example.com', 'api/internal/products')).toBe(
      'https://sequencer.example.com/api/internal/products',
    )
    expect(joinApiUrl('', '/api/internal/products')).toBe('/api/internal/products')
  })

  // -------------------------------------------------------------------------
  // apiFetch — success path
  // -------------------------------------------------------------------------

  it('returns parsed JSON on a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson({ ok: true })),
    )
    await expect(apiFetch('/api/internal/example')).resolves.toEqual({ ok: true })
  })

  it('sends Content-Type: application/json header and merges extra init', async () => {
    const fetchMock = vi.fn(async () => okJson({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/internal/example', {
      method: 'POST',
      headers: { 'X-Custom': 'yes' },
      body: '{}',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/example',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom': 'yes',
        }),
        body: '{}',
      }),
    )
  })

  // -------------------------------------------------------------------------
  // apiFetch — error paths
  // -------------------------------------------------------------------------

  it('falls back to statusText when JSON parse fails on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('not json', {
            status: 502,
            statusText: 'Bad Gateway',
          }),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Bad Gateway',
      status: 502,
    })
  })

  it('uses "API error" title when error field is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'oops' }), { status: 500 })),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'API error',
      status: 500,
    })
  })

  it('uses "API error" title when error field is blank string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '   ' }), { status: 500 })),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'API error',
      status: 500,
    })
  })

  it('returns plain title when detail/details is present but empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Something failed', detail: '   ' }), {
            status: 422,
          }),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Something failed',
      status: 422,
    })
  })

  it('formats detail when it is a plain string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Validation error', detail: 'field is required' }), {
            status: 422,
          }),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Validation error: field is required',
      status: 422,
    })
  })

  it('returns plain title when details.fieldErrors is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Bad', details: { otherInfo: 'x' } }), {
            status: 400,
          }),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Bad',
      status: 400,
    })
  })

  it('returns plain title when details.fieldErrors is not an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Bad', details: { fieldErrors: 'notanobject' } }), {
            status: 400,
          }),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Bad',
      status: 400,
    })
  })

  it('returns plain title when details is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'Bad', details: null }), { status: 400 }),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Bad',
      status: 400,
    })
  })

  it('formats fieldErrors where value is a string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Validation error',
              details: { fieldErrors: { name: 'too short' } },
            }),
            { status: 400 },
          ),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Validation error: name: too short',
      status: 400,
    })
  })

  it('omits blank string values in fieldErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Validation error',
              details: { fieldErrors: { name: '   ' } },
            }),
            { status: 400 },
          ),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Validation error',
      status: 400,
    })
  })

  it('omits blank/non-string items within array fieldErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Validation error',
              details: { fieldErrors: { name: ['  ', 42, 'real error'] } },
            }),
            { status: 400 },
          ),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Validation error: name: real error',
      status: 400,
    })
  })

  it('returns plain title when fieldErrors has values that produce no messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Validation error',
              details: { fieldErrors: {} },
            }),
            { status: 400 },
          ),
      ),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'Validation error',
      status: 400,
    })
  })

  it('ignores null/non-object error body for formatting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(null), { status: 500 })),
    )

    await expect(apiFetch('/api/internal/example')).rejects.toMatchObject({
      message: 'API error',
      status: 500,
    })
  })

  // -------------------------------------------------------------------------
  // apiFetchText — error paths
  // -------------------------------------------------------------------------

  it('falls back to text() when clone().json() fails on apiFetchText', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('plain error text', { status: 500, statusText: 'ISE' })),
    )

    await expect(apiFetchText('/api/internal/preview')).rejects.toMatchObject({
      message: 'plain error text',
      status: 500,
    })
  })

  it('falls back to statusText when both json() and text() fail on apiFetchText', async () => {
    const badRes = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      clone: () => ({
        json: async () => {
          throw new Error('json fail')
        },
      }),
      text: async () => {
        throw new Error('text fail')
      },
    } as unknown as Response

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => badRes),
    )

    await expect(apiFetchText('/api/internal/preview')).rejects.toMatchObject({
      message: 'Service Unavailable',
      status: 503,
    })
  })

  // -------------------------------------------------------------------------
  // joinApiUrl / apiUrl
  // -------------------------------------------------------------------------

  it('apiUrl returns path unchanged when BASE is empty', () => {
    // VITE_API_URL is not set in test env, so BASE defaults to ''
    expect(apiUrl('/api/internal/products')).toBe('/api/internal/products')
  })
})

// ---------------------------------------------------------------------------
// High-level API functions
// ---------------------------------------------------------------------------

describe('API helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getMe calls /me and returns parsed body', async () => {
    const fetchMock = vi.fn(async () => okJson({ email: 'user@example.com', authenticated: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMe()).resolves.toEqual({ email: 'user@example.com', authenticated: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('getOverview calls /api/internal/overview', async () => {
    const overview = { products: [], sequences: [], contacts: 0, suppressions: 0 }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson(overview)),
    )

    await expect(getOverview()).resolves.toEqual(overview)
  })

  it('getSequences calls without product filter when slug is omitted', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSequences()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/sequences', expect.anything())
  })

  it('getSequences appends product query param when slug is provided', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getSequences('my-product')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/sequences?product=my-product',
      expect.anything(),
    )
  })

  it('getContacts calls without query when omitted', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getContacts()
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/contacts', expect.anything())
  })

  it('getContacts treats an empty params object as no query string', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getContacts({})
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/contacts', expect.anything())
  })

  it('getContacts appends encoded q param when query is provided', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getContacts({ q: 'hello world' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/contacts?q=hello%20world',
      expect.anything(),
    )
  })

  it('getContacts appends product, sort, dir, limit, and offset params', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getContacts({ product: 'cap veri', sort: 'email', dir: 'asc', limit: 25, offset: 50 })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/contacts?product=cap%20veri&sort=email&dir=asc&limit=25&offset=50',
      expect.anything(),
    )
  })

  it('updateSequence sends PATCH with encoded slug and JSON body', async () => {
    const fetchMock = vi.fn(async () => okJson({ slug: 'a/b' }))
    vi.stubGlobal('fetch', fetchMock)

    await updateSequence('a/b', {
      goal: 'activation',
      is_active: false,
      definition: { steps: [] },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/sequences/a%2Fb',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          goal: 'activation',
          is_active: false,
          definition: { steps: [] },
        }),
      }),
    )
  })

  it('createSequence sends POST with sequence fields', async () => {
    const fetchMock = vi.fn(async () => okJson({ slug: 'new-flow' }))
    vi.stubGlobal('fetch', fetchMock)

    await createSequence({
      slug: 'new-flow',
      product_id: 'prod_1',
      goal: 'activation',
      is_active: true,
      definition: { steps: [] },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/sequences',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          slug: 'new-flow',
          product_id: 'prod_1',
          goal: 'activation',
          is_active: true,
          definition: { steps: [] },
        }),
      }),
    )
  })

  it('deleteSequence sends DELETE to the encoded sequence URL', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteSequence('a/b')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/sequences/a%2Fb',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('getContacts appends active_sequence when provided', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getContacts({ active_sequence: 'welcome flow' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/contacts?active_sequence=welcome%20flow',
      expect.anything(),
    )
  })

  it('getContacts includes offset of 0 explicitly', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getContacts({ offset: 0 })
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/contacts?offset=0', expect.anything())
  })

  it('getContactDetail encodes the contact id in the path', async () => {
    const fetchMock = vi.fn(async () => okJson({ id: 'a/b' }))
    vi.stubGlobal('fetch', fetchMock)

    await getContactDetail('a/b')
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/contacts/a%2Fb', expect.anything())
  })

  it('deleteContact sends DELETE to the encoded contact URL', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteContact('a/b')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/contacts/a%2Fb',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('createContact sends POST with contact fields', async () => {
    const fetchMock = vi.fn(async () => okJson({ id: 'contact_1' }))
    vi.stubGlobal('fetch', fetchMock)

    await createContact({
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      product_id: 'prod_1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/contacts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'alice@example.com',
          first_name: 'Alice',
          last_name: 'Smith',
          product_id: 'prod_1',
        }),
      }),
    )
  })

  it('updateContact sends PATCH to the encoded contact URL', async () => {
    const fetchMock = vi.fn(async () => okJson({ id: 'contact/1' }))
    vi.stubGlobal('fetch', fetchMock)

    await updateContact('contact/1', {
      email: 'alice.updated@example.com',
      first_name: 'Alicia',
      last_name: null,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/contacts/contact%2F1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          email: 'alice.updated@example.com',
          first_name: 'Alicia',
          last_name: null,
        }),
      }),
    )
  })

  it('getSuppressions calls without scope when omitted', async () => {
    const fetchMock = vi.fn(async () => okJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await getSuppressions()
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/suppressions', expect.anything())
  })

  it('getProducts returns product list', async () => {
    const products = [{ id: '1', name: 'Prod', slug: 'prod' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson(products)),
    )

    await expect(getProducts()).resolves.toEqual(products)
  })

  it('createProduct sends POST with product fields', async () => {
    const fetchMock = vi.fn(async () => okJson({ id: 'prod_acme' }))
    vi.stubGlobal('fetch', fetchMock)

    const data = {
      slug: 'acme',
      name: 'Acme Mailer',
      brand_color: '#ff0000',
      default_from_email: 'hi@acme.test',
      default_reply_to: null,
      resend_api_key_secret_name: 'RESEND_ACME',
      suppression_scope: 'global' as const,
      firewall_partner_id: null,
    }
    await createProduct(data)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/products',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    )
  })

  it('updateProduct sends PATCH with encoded id', async () => {
    const fetchMock = vi.fn(async () => okJson({ id: 'prod/acme' }))
    vi.stubGlobal('fetch', fetchMock)

    await updateProduct('prod/acme', { name: 'Acme Updated' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/products/prod%2Facme',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Acme Updated' }),
      }),
    )
  })

  it('deleteProduct sends DELETE to encoded product id', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteProduct('prod/acme')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/products/prod%2Facme',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('getApiTokens returns token list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson([])),
    )
    await expect(getApiTokens()).resolves.toEqual([])
  })

  it('createApiToken sends POST with body', async () => {
    const token = { id: 't1', product_id: 'p1', label: 'My token' }
    const fetchMock = vi.fn(async () => okJson({ ok: true, token }))
    vi.stubGlobal('fetch', fetchMock)

    const data = {
      product_id: 'p1',
      label: 'My token',
      access_service_token_id: 'svc1',
    }
    await expect(createApiToken(data)).resolves.toEqual({ ok: true, token })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/api-tokens',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    )
  })

  it('createApiToken works without optional label', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true, token: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await createApiToken({ product_id: 'p1', access_service_token_id: 'svc1' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/api-tokens',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('revokeApiToken sends POST to encoded revoke URL', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(revokeApiToken('tok/1')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/api-tokens/tok%2F1/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('getTemplates returns template list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson([])),
    )
    await expect(getTemplates()).resolves.toEqual([])
  })

  it('getLeadMagnets returns lead magnet list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson([])),
    )
    await expect(getLeadMagnets()).resolves.toEqual([])
  })

  it('getDeliverability returns deliverability data', async () => {
    const data = { domains: [], instantly_campaigns: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson(data)),
    )
    await expect(getDeliverability()).resolves.toEqual(data)
  })

  it('updateInstantlyCampaign sends PATCH with encoded id', async () => {
    const fetchMock = vi.fn(async () => okJson({ updated: true }))
    vi.stubGlobal('fetch', fetchMock)

    await updateInstantlyCampaign('camp/1', { product_id: 'p1' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/deliverability/instantly-campaigns/camp%2F1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ product_id: 'p1' }),
      }),
    )
  })

  it('updateInstantlyCampaign allows null product_id', async () => {
    const fetchMock = vi.fn(async () => okJson({}))
    vi.stubGlobal('fetch', fetchMock)

    await updateInstantlyCampaign('camp1', { product_id: null })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/deliverability/instantly-campaigns/camp1',
      expect.objectContaining({ body: JSON.stringify({ product_id: null }) }),
    )
  })

  it('createLeadMagnet sends POST with body', async () => {
    const lm = { id: 'lm1', product_id: 'p1', slug: 's', name: 'N', active: true, created_at: '' }
    const fetchMock = vi.fn(async () => okJson(lm))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createLeadMagnet({ product_id: 'p1', slug: 's', name: 'N' })).resolves.toEqual(lm)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/lead-magnets',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('updateLeadMagnet sends PATCH with encoded id', async () => {
    const lm = { id: 'lm/1', product_id: 'p1', slug: 's', name: 'N', active: true, created_at: '' }
    const fetchMock = vi.fn(async () => okJson(lm))
    vi.stubGlobal('fetch', fetchMock)

    await updateLeadMagnet('lm/1', { name: 'Updated' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/lead-magnets/lm%2F1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
      }),
    )
  })

  it('deleteLeadMagnet sends DELETE to encoded lead magnet id', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteLeadMagnet('lm/1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/lead-magnets/lm%2F1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('getAuditLog defaults to page 1 when no page provided', async () => {
    const fetchMock = vi.fn(async () => okJson({ entries: [], has_next: false }))
    vi.stubGlobal('fetch', fetchMock)

    await getAuditLog()
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/audit?page=1', expect.anything())
  })

  it('getAuditLog appends actor, action, from, and to filters', async () => {
    const fetchMock = vi.fn(async () => okJson({ entries: [], has_next: false }))
    vi.stubGlobal('fetch', fetchMock)

    await getAuditLog({
      page: 3,
      actor: 'a@b.com',
      action: 'suppression.removed',
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/audit?page=3&actor=a%40b.com&action=suppression.removed&from=2026-01-01&to=2026-01-31',
      expect.anything(),
    )
  })

  it('addSuppression sends POST with required fields', async () => {
    const fetchMock = vi.fn(async () => okJson(null))
    vi.stubGlobal('fetch', fetchMock)

    await addSuppression({ email: 'test@example.com', scope: 'global' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/suppressions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', scope: 'global' }),
      }),
    )
  })

  it('addSuppression sends POST with optional product_id and reason', async () => {
    const fetchMock = vi.fn(async () => okJson(null))
    vi.stubGlobal('fetch', fetchMock)

    await addSuppression({
      email: 'test@example.com',
      scope: 'product',
      product_id: 'p1',
      reason: 'spam',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/suppressions',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'test@example.com',
          scope: 'product',
          product_id: 'p1',
          reason: 'spam',
        }),
      }),
    )
  })

  it('removeSuppression sends DELETE to encoded suppression URL', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(removeSuppression('sup/1')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/suppressions/sup%2F1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
