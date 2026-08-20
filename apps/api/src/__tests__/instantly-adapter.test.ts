import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstantlyAdapter } from '../providers/instantly'

function env() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
  }
}

describe('InstantlyAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when campaign listing fails instead of returning an empty successful sync result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.listCampaigns()).rejects.toThrow(
      'Instantly listCampaigns failed with 429: rate limited',
    )
  })

  it('accepts direct and wrapped campaign arrays from campaign listing', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ id: 'campaign_1', name: 'One', status: 'active' }]))
      .mockResolvedValueOnce(
        Response.json({ campaigns: [{ id: 'campaign_2', name: 'Two', status: 'paused' }] }),
      )
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.listCampaigns()).resolves.toEqual([
      { id: 'campaign_1', name: 'One', status: 'active' },
    ])
    await expect(adapter.listCampaigns()).resolves.toEqual([
      { id: 'campaign_2', name: 'Two', status: 'paused' },
    ])
  })

  it('accepts current v2 paginated campaign list responses', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        items: [
          {
            id: 'campaign_1',
            name: 'One',
            status: 1,
            timestamp_created: '2026-05-18T16:00:49.585Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.listCampaigns()).resolves.toEqual([
      {
        id: 'campaign_1',
        name: 'One',
        status: '1',
        created_at: '2026-05-18T16:00:49.585Z',
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      'https://api.instantly.ai/api/v2/campaigns?limit=100',
      expect.objectContaining({ headers: { Authorization: 'Bearer instantly-key' } }),
    )
  })

  it('follows current v2 campaign pagination cursors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'campaign_1', name: 'One', status: 1 }],
          next_starting_after: 'cursor_1',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'campaign_2', name: 'Two', status: 2 }],
        }),
      )
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.listCampaigns()).resolves.toEqual([
      { id: 'campaign_1', name: 'One', status: '1', created_at: undefined },
      { id: 'campaign_2', name: 'Two', status: '2', created_at: undefined },
    ])
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.instantly.ai/api/v2/campaigns?limit=100',
      expect.anything(),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.instantly.ai/api/v2/campaigns?limit=100&starting_after=cursor_1',
      expect.anything(),
    )
  })

  it('throws a clear error when campaign listing returns an unexpected success payload shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true })),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.listCampaigns()).rejects.toThrow(
      'Instantly listCampaigns returned an unexpected payload shape',
    )
  })

  it('throws when campaign analytics fails instead of returning null stats', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream error', { status: 502 })),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.getCampaignAnalytics('campaign_1', '2026-05-19')).rejects.toThrow(
      'Instantly getAnalytics failed with 502 for campaign campaign_1: upstream error',
    )
  })

  it('maps valid campaign analytics metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          total_sent: 10,
          total_opened: 7,
          total_replied: 2,
          total_interested: 1,
          total_bounced: 3,
        }),
      ),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.getCampaignAnalytics('campaign_1', '2026-05-19')).resolves.toEqual({
      campaign_id: 'campaign_1',
      date: '2026-05-19',
      sent: 10,
      opened: 7,
      replied: 2,
      interested: 1,
      bounced: 3,
    })
  })

  it('maps current v2 campaign analytics response arrays', async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        {
          campaign_id: 'campaign_1',
          emails_sent_count: 10,
          open_count: 7,
          reply_count: 2,
          total_opportunities: 1,
          bounced_count: 3,
        },
      ]),
    )
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.getCampaignAnalytics('campaign_1', '2026-05-19')).resolves.toEqual({
      campaign_id: 'campaign_1',
      date: '2026-05-19',
      sent: 10,
      opened: 7,
      replied: 2,
      interested: 1,
      bounced: 3,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.instantly.ai/api/v2/campaigns/analytics?id=campaign_1&start_date=2026-05-19&end_date=2026-05-19',
      expect.objectContaining({ headers: { Authorization: 'Bearer instantly-key' } }),
    )
  })

  it('maps empty campaign analytics arrays to zero stats', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([])),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.getCampaignAnalytics('campaign_1', '2026-05-19')).resolves.toEqual({
      campaign_id: 'campaign_1',
      date: '2026-05-19',
      sent: 0,
      opened: 0,
      replied: 0,
      interested: 0,
      bounced: 0,
    })
  })

  it('throws when campaign analytics returns an unexpected success payload shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true })),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.getCampaignAnalytics('campaign_1', '2026-05-19')).rejects.toThrow(
      'Instantly getAnalytics returned an unexpected payload shape',
    )
  })

  it('throws when campaign analytics metrics are not numbers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ total_sent: '5' })),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.getCampaignAnalytics('campaign_1', '2026-05-19')).rejects.toThrow(
      'Instantly getAnalytics returned an unexpected payload shape',
    )
  })

  it('truncates long provider failure bodies before logging or throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(300), { status: 500 })),
    )
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(adapter.listCampaigns()).rejects.toThrow(
      `Instantly listCampaigns failed with 500: ${'x'.repeat(197)}...`,
    )
  })

  it('tags converted signup leads and moves active campaign leads to the configured list', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'campaign_1', name: 'Campaign One', status: 1 }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              id: 'lead_1',
              email: 'lead@example.com',
              campaign: 'campaign_1',
              payload: { existing: 'value' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'lead_1' }))
      .mockResolvedValueOnce(Response.json({ id: 'job_1' }))
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', {
      ...env(),
      INSTANTLY_CONVERTED_SIGNUPS_LIST_ID: 'converted_list',
    } as never)

    await expect(
      adapter.markConvertedSignup({
        email: 'Lead@Example.com',
        product: 'grantpipe',
        event: 'signup_completed',
        properties: { ve_campaign_id: 'gp-campaign-1' },
      }),
    ).resolves.toEqual({ leadsUpdated: 1, moveJobsStarted: 1 })

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.instantly.ai/api/v2/campaigns/search-by-contact?search=lead%40example.com',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
      contacts: ['lead@example.com'],
      limit: 100,
      campaign: 'campaign_1',
    })
    expect(JSON.parse(fetch.mock.calls[2]![1].body)).toEqual({
      custom_variables: {
        existing: 'value',
        ventora_signup_completed: true,
        ventora_signup_product: 'grantpipe',
        ventora_signup_event: 'signup_completed',
        ventora_signup_at: expect.any(String),
        ventora_signup_ve_campaign_id: 'gp-campaign-1',
      },
    })
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      'https://api.instantly.ai/api/v2/leads/move',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({
      campaign: 'campaign_1',
      ids: ['lead_1'],
      to_list_id: 'converted_list',
      copy_leads: false,
      reset_interest_status: false,
    })
  })

  it('tags converted signup leads without moving them when no converted list is configured', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'campaign_1', name: 'Campaign One', status: 1 }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'lead_1', email: 'lead@example.com', campaign: 'campaign_1' }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'lead_1' }))
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(
      adapter.markConvertedSignup({
        email: 'lead@example.com',
        product: 'floriva-web',
        event: 'signup_completed',
      }),
    ).resolves.toEqual({ leadsUpdated: 1, moveJobsStarted: 0 })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('falls back to workspace lead search when contact is in no campaigns', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'lead_1', email: 'lead@example.com' }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'lead_1' }))
    vi.stubGlobal('fetch', fetch)
    const adapter = new InstantlyAdapter('instantly-key', env() as never)

    await expect(
      adapter.markConvertedSignup({
        email: 'lead@example.com',
        product: 'camaudit',
        event: 'paid_conversion',
      }),
    ).resolves.toEqual({ leadsUpdated: 1, moveJobsStarted: 0 })
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
      contacts: ['lead@example.com'],
      limit: 100,
    })
  })
})
