import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SequencerApiError, SequencerClient } from '../index'

describe('SequencerClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a contact timeline through the product API with an encoded email path', async () => {
    const responseBody = {
      id: 'contact_1',
      email: 'User@Example.com',
      first_name: 'User',
      last_name: null,
      properties: { plan: 'pro' },
      created_at: '2026-05-12T09:00:00.000Z',
      updated_at: '2026-05-12T09:00:00.000Z',
      products: [{ contact_id: 'contact_1', product_id: 'prod_1', status: 'active' }],
      runs: [
        {
          id: 'run_1',
          sequence_slug: 'camaudit-welcome',
          status: 'running',
          started_at: '2026-05-12T09:05:00.000Z',
          steps: [
            {
              id: 'step_1',
              run_id: 'run_1',
              status: 'sent',
              message: { id: 'msg_1', resend_message_id: 'email_1' },
              events: [{ id: 'evt_1', type: 'email.opened' }],
            },
          ],
        },
      ],
      messages: [{ id: 'msg_1', resend_message_id: 'email_1' }],
      events: [{ id: 'evt_1', type: 'email.opened', received_at: '2026-05-12T09:10:00.000Z' }],
      timeline: [
        { kind: 'run.started', at: '2026-05-12T09:05:00.000Z', run_id: 'run_1', status: 'running' },
        {
          kind: 'event.email.opened',
          at: '2026-05-12T09:10:00.000Z',
          event_id: 'evt_1',
          type: 'email.opened',
        },
      ],
    }
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com/',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    const result = await client.getContactTimeline('User@Example.com')

    expect(result).toEqual(responseBody)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sequencer.ventoralabs.com/api/v1/contacts/User%40Example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'client-id',
          'CF-Access-Client-Secret': 'client-secret',
        }),
      }),
    )
  })

  it('downloads lead magnets through the product API with Access service token headers', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
            run_id: 'run_1',
            status: 'enrolled',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com/',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    const result = await client.downloadLeadMagnet('tenant', {
      email: 'user@example.com',
      first_name: 'User',
      source: 'lead_magnet_form',
      utm: { source: 'site' },
    })

    expect(result).toEqual({
      ok: true,
      asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
      run_id: 'run_1',
      status: 'enrolled',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant/download',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'user@example.com',
          first_name: 'User',
          source: 'lead_magnet_form',
          utm: { source: 'site' },
        }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'client-id',
          'CF-Access-Client-Secret': 'client-secret',
        }),
      }),
    )
  })

  it('sends lead magnet download idempotency keys when provided', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
            run_id: 'run_1',
            status: 'enrolled',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com/',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await client.downloadLeadMagnet(
      'tenant',
      {
        email: 'user@example.com',
      },
      { idempotencyKey: 'tenant-user-1' },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sequencer.ventoralabs.com/api/v1/lead-magnets/tenant/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'tenant-user-1',
        }),
      }),
    )
  })

  it('returns lead magnet fulfillment failures that still include an asset URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: 'fulfillment_failed',
              detail: 'Lead magnet asset is available, but fulfillment sequence start failed',
              asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
              run_id: 'run_1',
              status: 'fulfillment_failed',
            }),
            {
              status: 207,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await expect(
      client.downloadLeadMagnet('tenant', {
        email: 'user@example.com',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'fulfillment_failed',
      detail: 'Lead magnet asset is available, but fulfillment sequence start failed',
      asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
      run_id: 'run_1',
      status: 'fulfillment_failed',
    })
  })

  it('returns lead magnet conversion delivery failures that still include an asset URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: 'conversion_event_delivery_failed',
              detail: 'Lead magnet asset is available, but conversion event delivery failed',
              asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
              run_id: 'run_1',
              status: 'already_running',
              notified_runs: 1,
              failed_runs: ['run_failed'],
            }),
            {
              status: 207,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await expect(
      client.downloadLeadMagnet('tenant', {
        email: 'user@example.com',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'conversion_event_delivery_failed',
      detail: 'Lead magnet asset is available, but conversion event delivery failed',
      asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
      run_id: 'run_1',
      status: 'already_running',
      notified_runs: 1,
      failed_runs: ['run_failed'],
    })
  })

  it('throws a structured error with response details when the API rejects a request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'forbidden_product',
              detail: 'Token is not authorized for this sequence',
            }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await expect(
      client.enroll({
        email: 'user@example.com',
        sequence_slug: 'camaudit-lead-magnet-tenant-checklist',
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'forbidden_product',
      detail: 'Token is not authorized for this sequence',
    } satisfies Partial<SequencerApiError>)
  })

  it('returns event delivery failures that use a non-error HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: 'event_delivery_failed',
              event: 'reply_received',
              notified_runs: 1,
              failed_runs: ['run_failed'],
            }),
            {
              status: 207,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await expect(
      client.fireEvent({
        email: 'user@example.com',
        product: 'camaudit',
        event: 'reply_received',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'event_delivery_failed',
      event: 'reply_received',
      notified_runs: 1,
      failed_runs: ['run_failed'],
    })
  })

  it('returns idempotent event replay metadata from successful event responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              event: 'reply_received',
              notified_runs: 0,
              duplicate: true,
              in_progress: true,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    const result = await client.fireEvent({
      email: 'user@example.com',
      product: 'camaudit',
      event: 'reply_received',
    })

    expect(result).toEqual({
      ok: true,
      event: 'reply_received',
      notified_runs: 0,
      duplicate: true,
      in_progress: true,
    })
    if (result.ok) {
      expect(result.duplicate).toBe(true)
      expect(result.in_progress).toBe(true)
    }
  })

  it('returns event transition run ids from successful event responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              event: 'onboarding_completed',
              notified_runs: 1,
              transitioned_runs: ['run_dollar_trail'],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await expect(
      client.fireEvent({
        email: 'user@example.com',
        product: 'floriva-web',
        event: 'onboarding_completed',
      }),
    ).resolves.toEqual({
      ok: true,
      event: 'onboarding_completed',
      notified_runs: 1,
      transitioned_runs: ['run_dollar_trail'],
    })
  })

  it('sends event idempotency keys when provided', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            event: 'reply_received',
            notified_runs: 0,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await client.fireEvent(
      {
        email: 'user@example.com',
        product: 'camaudit',
        event: 'reply_received',
      },
      { idempotencyKey: 'reply-user-1' },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sequencer.ventoralabs.com/api/v1/events',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'reply-user-1',
        }),
      }),
    )
  })

  it('returns unsubscribe delivery failures that use a non-error HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: 'unsubscribe_delivery_failed',
              email: 'user@example.com',
              scope: 'product',
              notified_runs: 1,
              failed_runs: ['run_failed'],
            }),
            {
              status: 207,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )

    const client = new SequencerClient({
      baseUrl: 'https://sequencer.ventoralabs.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    await expect(
      client.unsubscribe({
        email: 'user@example.com',
        product: 'camaudit',
        scope: 'product',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'unsubscribe_delivery_failed',
      email: 'user@example.com',
      scope: 'product',
      notified_runs: 1,
      failed_runs: ['run_failed'],
    })
  })
})
