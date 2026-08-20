import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireProductApiClientContext = vi.fn()
const enqueueInstantlySuppressionJob = vi.fn()
const processInstantlySuppressionJobByKey = vi.fn()
const insertValues = vi.fn()
const insertOnConflictDoNothing = vi.fn()
const updateSet = vi.fn()
const updateWhere = vi.fn()
let scopedActiveRuns = [{ id: 'run_caller_product' }]
let eventRows: Array<Record<string, unknown>> = []
let updateWhereResult: ((value: Record<string, unknown>, where: unknown) => unknown) | null = null

vi.mock('../lib/product-api-auth', () => ({
  requireProductApiClientContext,
}))

vi.mock('../lib/instantly-suppression-jobs', () => ({
  enqueueInstantlySuppressionJob,
  processInstantlySuppressionJobByKey,
}))

vi.mock('@sequencer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sequencer/db')>()
  const contact = { id: 'contact_shared', email: 'shared@example.com' }

  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((value) => {
        insertValues(value)
        return { onConflictDoNothing: insertOnConflictDoNothing }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value) => {
        updateSet(value)
        return {
          where: vi.fn((where) => {
            updateWhere(where)
            return updateWhereResult?.(value, where)
          }),
        }
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table) => {
        if (table === actual.events) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => eventRows),
            })),
          }
        }

        if (table === actual.contacts) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => [contact]),
            })),
          }
        }

        if (table === actual.products) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => [{ id: 'prod_camaudit' }]),
            })),
          }
        }

        if (table === actual.sequence_runs) {
          const scopedRunsQuery = {
            where: vi.fn(() => scopedActiveRuns),
          }
          return {
            innerJoin: vi.fn(() => {
              throw new Error(
                'events route should scope runs with sequence_runs.product_id, not sequence joins',
              )
            }),
            ...scopedRunsQuery,
          }
        }

        throw new Error('Unexpected table in events product scope test')
      }),
    })),
  }

  return {
    ...actual,
    createDb: vi.fn(() => db),
  }
})

function baseEnv(fetch = vi.fn(async () => new Response(null, { status: 204 }))) {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    DB: {},
    ANALYTICS: { writeDataPoint: vi.fn() },
    SEQUENCE_RUN: {
      idFromName: vi.fn((id: string) => ({ id })),
      get: vi.fn(() => ({ fetch })),
    },
    __sequenceRunFetch: fetch,
  }
}

describe('events route product scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireProductApiClientContext.mockResolvedValue({
      productSlug: 'camaudit',
      clientId: 'client-1.access',
    })
    scopedActiveRuns = [{ id: 'run_caller_product' }]
    eventRows = []
    updateWhereResult = null
    enqueueInstantlySuppressionJob.mockResolvedValue(undefined)
    processInstantlySuppressionJobByKey.mockResolvedValue('succeeded')
  })

  it('notifies only active runs owned by the caller product for the shared contact email', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
          properties: { source: 'test' },
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, event: 'reply_received', notified_runs: 1 })
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledOnce()
    expect(env.SEQUENCE_RUN.idFromName).toHaveBeenCalledWith('run_caller_product')
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalledWith('run_other_product')
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('rejects blank event names before persisting or notifying active runs', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: '   ',
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(insertValues).not.toHaveBeenCalled()
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('queues converted signups for durable Instantly suppression without blocking the product event response', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'signup_completed',
          properties: { ve_campaign_id: 'cam-campaign-1' },
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(enqueueInstantlySuppressionJob).toHaveBeenCalledWith(env, {
      key: 'fallback:camaudit:signup_completed:shared@example.com',
      email: 'shared@example.com',
      product: 'camaudit',
      event: 'signup_completed',
      properties: { ve_campaign_id: 'cam-campaign-1' },
    })
    expect(processInstantlySuppressionJobByKey).not.toHaveBeenCalled()
  })

  it('does not fail product event recording when Instantly suppression processing fails after enqueue', async () => {
    processInstantlySuppressionJobByKey.mockRejectedValueOnce(new Error('instantly down'))
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'signup_completed',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, event: 'signup_completed' })
    expect(enqueueInstantlySuppressionJob).toHaveBeenCalledOnce()
  })

  it('returns a delivery failure when an active run DO responds with an error', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv(vi.fn(async () => new Response('boom', { status: 500 })))

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'event_delivery_failed',
      event: 'reply_received',
      notified_runs: 0,
      failed_runs: ['run_caller_product'],
    })
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply_received',
        payload: expect.objectContaining({ email: 'shared@example.com', product: 'camaudit' }),
      }),
    )
  })

  it('returns a delivery failure when notifying an active run DO throws', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv(
      vi.fn(async () => {
        throw new Error('DO unavailable')
      }),
    )

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'event_delivery_failed',
      event: 'reply_received',
      notified_runs: 0,
      failed_runs: ['run_caller_product'],
    })
  })

  it('reports partial delivery without inviting a full event retry', async () => {
    scopedActiveRuns = [{ id: 'run_ok' }, { id: 'run_failed' }]
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const env = baseEnv(fetch)

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(207)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'event_delivery_failed',
      event: 'reply_received',
      notified_runs: 1,
      failed_runs: ['run_failed'],
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('deduplicates completed product events by Idempotency-Key before notifying runs', async () => {
    eventRows = [
      {
        id: 'event_existing',
        type: 'reply_received',
        payload: {
          email: 'shared@example.com',
          product: 'camaudit',
          event: 'reply_received',
          properties: {},
        },
        sideEffectsCompletedAt: '2026-05-12T10:00:00.000Z',
      },
    ]
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'product-event-1',
        },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      event: 'reply_received',
      notified_runs: 0,
      duplicate: true,
    })
    expect(insertValues).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })

  it('rejects reused product event idempotency keys when the event payload differs', async () => {
    eventRows = [
      {
        id: 'event_existing',
        type: 'reply_received',
        payload: {
          email: 'shared@example.com',
          product: 'camaudit',
          event: 'reply_received',
          properties: {},
        },
        sideEffectsCompletedAt: '2026-05-12T10:00:00.000Z',
      },
    ]
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'product-event-1',
        },
        body: JSON.stringify({
          email: 'Other@Example.com',
          product: 'camaudit',
          event: 'booked_demo',
          properties: { source: 'calendar' },
        }),
      },
      env,
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'idempotency_key_conflict' })
    expect(insertValues).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })

  it('rejects product event idempotency conflicts discovered after an insert race', async () => {
    insertOnConflictDoNothing.mockImplementationOnce(async () => {
      eventRows = [
        {
          id: 'event_existing',
          type: 'booked_demo',
          payload: {
            email: 'shared@example.com',
            product: 'camaudit',
            event: 'booked_demo',
            properties: { source: 'calendar' },
          },
          sideEffectsStartedAt: null,
          sideEffectsCompletedAt: null,
        },
      ]
      return { meta: { changes: 0 } }
    })
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'product-event-1',
        },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'idempotency_key_conflict' })
    expect(updateSet).not.toHaveBeenCalled()
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })

  it('stores and completes product event idempotency keys after successful delivery', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'product-event-1',
        },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'internal',
        provider_event_id: 'api:client-1.access:product-event-1',
        type: 'reply_received',
        side_effects_started_at: null,
        side_effects_completed_at: null,
      }),
    )
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_started_at: expect.any(String),
      }),
    )
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        side_effects_completed_at: expect.any(String),
        side_effects_started_at: null,
      }),
    )
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('reports a retryable failure when product event side-effect completion loses its lease', async () => {
    updateWhereResult = (value) => {
      if (typeof value.side_effects_started_at === 'string') return { meta: { changes: 1 } }
      if (typeof value.side_effects_completed_at === 'string') return { meta: { changes: 0 } }
      return undefined
    }
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'product-event-1',
        },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'event_completion_failed',
      event: 'reply_received',
      notified_runs: 1,
    })
    expect(env.__sequenceRunFetch).toHaveBeenCalledOnce()
  })

  it('does not notify active runs when an idempotent product event is already in progress', async () => {
    eventRows = [
      {
        id: 'event_existing',
        sideEffectsStartedAt: '2026-05-12T09:59:59.000Z',
        sideEffectsCompletedAt: null,
      },
    ]
    insertOnConflictDoNothing.mockResolvedValueOnce({ meta: { changes: 0 } })
    updateWhereResult = (value) =>
      typeof value.side_effects_started_at === 'string' ? { meta: { changes: 0 } } : undefined
    const { eventsRoute } = await import('../routes/api/v1/events')
    const app = new Hono()
    app.route('/api/v1/events', eventsRoute)
    const env = baseEnv()

    const res = await app.request(
      '/api/v1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'product-event-1',
        },
        body: JSON.stringify({
          email: 'Shared@Example.com',
          product: 'camaudit',
          event: 'reply_received',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      event: 'reply_received',
      notified_runs: 0,
      duplicate: true,
      in_progress: true,
    })
    expect(env.__sequenceRunFetch).not.toHaveBeenCalled()
  })
})
