import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 4:30 PM America/Chicago — inside the 8:00–17:00 send window so the DO send
// path does not defer. Tests that exercise deferral pin their own Date.now.
const IN_SEND_WINDOW_NOW = Date.parse('2026-06-01T21:30:00.000Z')

const renderEmailForTemplate = vi.fn()
const resendSend = vi.fn()
const createResendAdapter = vi.fn(() => ({ send: resendSend }))
const checkSuppression = vi.fn()
const checkFirewall = vi.fn()
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
  status: 'sequence_runs.status',
}
const sequences = {
  __name: 'sequences',
  slug: 'sequences.slug',
  product_id: 'sequences.product_id',
  version: 'sequences.version',
  definition: 'sequences.definition',
  exit_conditions: 'sequences.exit_conditions',
  is_active: 'sequences.is_active',
}
const steps = {
  __name: 'steps',
  id: 'steps.id',
  run_id: 'steps.run_id',
  step_index: 'steps.step_index',
  status: 'steps.status',
}
const products = {
  __name: 'products',
  id: 'products.id',
  default_from_email: 'products.default_from_email',
  default_reply_to: 'products.default_reply_to',
  resend_api_key_secret_name: 'products.resend_api_key_secret_name',
}
const contacts = {
  __name: 'contacts',
  id: 'contacts.id',
  email: 'contacts.email',
  first_name: 'contacts.first_name',
  last_name: 'contacts.last_name',
  properties: 'contacts.properties',
}
const contact_products = {
  __name: 'contact_products',
  contact_id: 'contact_products.contact_id',
  product_id: 'contact_products.product_id',
  first_name: 'contact_products.first_name',
  last_name: 'contact_products.last_name',
  properties: 'contact_products.properties',
}
const events = {
  __name: 'events',
  type: 'events.type',
  provider: 'events.provider',
  payload: 'events.payload',
}
const messages = {
  __name: 'messages',
  id: 'messages.id',
  step_id: 'messages.step_id',
  resend_message_id: 'messages.resend_message_id',
  sent_at: 'messages.sent_at',
}

const selectRows = new Map<string, unknown[]>()
const updates: Array<{ table: { __name: string }; values: Record<string, unknown> }> = []
const updateWheres: Array<{ table: { __name: string }; where: unknown }> = []
const inserts: Array<{ table: { __name: string }; values: Record<string, unknown> }> = []
let updateShouldThrow:
  | ((table: { __name: string }, values: Record<string, unknown>) => boolean)
  | null = null
let insertShouldThrow:
  | ((table: { __name: string }, values: Record<string, unknown>) => boolean)
  | null = null
let selectShouldThrow: ((table: { __name: string }) => boolean) | null = null
const rawQueries: Array<{ sql: string; binds: unknown[] }> = []
const storagePut = vi.fn()
const storageDeleteAlarm = vi.fn()
const storageSetAlarm = vi.fn()
const deadLetterSend = vi.fn()
const logsBucketPut = vi.fn()

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
  ne: (column: unknown, value: unknown) => ({ op: 'ne', column, value }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: (table: { __name: string }) => {
        const builder = {
          where: () => builder,
          limit: async () => {
            if (selectShouldThrow?.(table)) {
              throw new Error('select failed')
            }
            return selectRows.get(table.__name) ?? []
          },
        }
        return builder
      },
    })),
    insert: vi.fn((table: { __name: string }) => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        if (insertShouldThrow?.(table, values)) {
          throw new Error('insert failed')
        }
      }),
    })),
    update: vi.fn((table: { __name: string }) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values })
        if (table.__name === 'steps' && values.status === 'sent') {
          selectRows.set('steps', [
            {
              id: 'step_1',
              status: 'sent',
              messageId: values.message_id,
              sentAt: values.sent_at,
            },
          ])
        }
        if (updateShouldThrow?.(table, values)) {
          throw new Error('update failed')
        }
        return {
          where: vi.fn(async (where: unknown) => {
            updateWheres.push({ table, where })
          }),
        }
      }),
    })),
  })),
  contacts,
  contact_products,
  events,
  messages,
  products,
  sequence_runs,
  sequences,
  steps,
}))

vi.mock('../lib/template-renderer', () => ({ renderEmailForTemplate }))
vi.mock('../lib/suppression', () => ({ checkSuppression }))
vi.mock('../lib/firewall', () => ({ checkFirewall }))
vi.mock('../lib/observability', () => ({ createLogger, trackMetric }))
vi.mock('../providers/resend', () => ({
  createResendAdapter,
}))

function env() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    UNSUBSCRIBE_SIGNING_SECRET: 'test-unsubscribe-signing-secret',
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...binds: unknown[]) => ({
          first: vi.fn(async () => {
            rawQueries.push({ sql, binds })
            const [eventType, email, product] = binds
            const allowsProductlessEvents = sql.includes("json_type(payload, '$.product') IS NULL")
            const matched = (selectRows.get('events') ?? []).some((row) => {
              const payload = (row as { payload: Record<string, unknown> }).payload
              return (
                (row as { type?: string }).type === eventType &&
                payload.email === email &&
                (payload.product === product ||
                  (allowsProductlessEvents && !Object.hasOwn(payload, 'product')))
              )
            })
            return matched ? { matched: 1 } : null
          }),
        })),
      })),
    },
    SUPPRESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    SESSIONS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ASSETS_BUCKET: { get: vi.fn() },
    LOGS_BUCKET: { put: logsBucketPut },
    ANALYTICS: { writeDataPoint: vi.fn() },
    EVENTS_QUEUE: { send: vi.fn() },
    DEAD_LETTER_QUEUE: { send: deadLetterSend },
  }
}

function durableObjectState(overrides: Record<string, unknown> = {}) {
  let currentState = {
    runId: 'run_1',
    contactId: 'contact_1',
    contactEmail: 'user@example.com',
    productId: 'prod_1',
    productSlug: 'camaudit',
    sequenceSlug: 'demo-sequence',
    sequenceVersion: 1,
    currentStepIndex: 0,
    variantId: null,
    retryCount: 0,
    status: 'running',
    ...overrides,
  }

  return {
    storage: {
      get: vi.fn(async () => currentState),
      put: vi.fn(async (key: string, value: typeof currentState) => {
        await storagePut(key, value)
        if (key === 'state') currentState = value
      }),
      deleteAlarm: storageDeleteAlarm,
      setAlarm: storageSetAlarm,
    },
  }
}

describe('SequenceRunDO database status guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectRows.clear()
    updates.length = 0
    updateWheres.length = 0
    inserts.length = 0
    rawQueries.length = 0
    updateShouldThrow = null
    insertShouldThrow = null
    selectShouldThrow = null
    deadLetterSend.mockResolvedValue(undefined)
    logsBucketPut.mockResolvedValue(undefined)
    checkSuppression.mockResolvedValue({ suppressed: false })
    checkFirewall.mockResolvedValue({ blocked: false })
    renderEmailForTemplate.mockResolvedValue({ html: '<p>Hello</p>', text: 'Hello' })
    resendSend.mockResolvedValue({ id: 'msg_1' })
    selectRows.set('sequence_runs', [{ status: 'exited' }])
    selectRows.set('sequences', [
      {
        product_id: 'prod_1',
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    selectRows.set('products', [
      {
        name: 'CAMAudit',
        brand_color: '#2e7d71',
        default_from_email: 'hello@example.com',
        default_reply_to: null,
        resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT_ROTATED',
      },
    ])
    selectRows.set('contacts', [{ email: 'user@example.com', first_name: null, last_name: null }])
    selectRows.set('contact_products', [])
    selectRows.set('events', [])
    selectRows.set('steps', [])
    selectRows.set('messages', [])
    vi.spyOn(Date, 'now').mockReturnValue(IN_SEND_WINDOW_NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects malformed JSON control requests without treating them as DO failures', async () => {
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/event', {
        method: 'POST',
        body: '{',
      }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(storagePut).not.toHaveBeenCalled()
  })

  it('rejects incomplete start requests before storing broken run state', async () => {
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run_1' }),
      }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(storagePut).not.toHaveBeenCalled()
    expect(storageSetAlarm).not.toHaveBeenCalled()
  })

  it('rejects start requests whose sequence belongs to a different product before storing state', async () => {
    selectRows.set('sequences', [
      {
        product_id: 'prod_camaudit',
        version: 1,
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run_1',
          contactId: 'contact_1',
          contactEmail: 'user@example.com',
          productId: 'prod_floriva_web',
          productSlug: 'floriva-web',
          sequenceSlug: 'demo-sequence',
          sequenceVersion: 1,
          variantId: null,
        }),
      }),
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Sequence does not belong to product' })
    expect(storagePut).not.toHaveBeenCalled()
    expect(storageSetAlarm).not.toHaveBeenCalled()
  })

  it('starts with the Central send window fallback when contact timezone lookup fails', async () => {
    selectRows.set('sequences', [
      {
        product_id: 'prod_1',
        version: 1,
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    selectShouldThrow = (table) => table.__name === 'contact_products'
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T05:00:00.000Z'))
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    try {
      const res = await instance.fetch(
        new Request('https://do/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: 'run_1',
            contactId: 'contact_1',
            contactEmail: 'user@example.com',
            productId: 'prod_1',
            productSlug: 'camaudit',
            sequenceSlug: 'demo-sequence',
            sequenceVersion: 1,
            variantId: null,
          }),
        }),
      )

      expect(res.status).toBe(200)
      expect(storagePut).toHaveBeenCalledWith('state', expect.objectContaining({ runId: 'run_1' }))
      expect(storageSetAlarm).toHaveBeenCalledWith(Date.parse('2026-06-01T13:00:00.000Z'))
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('exits local DO state and deletes the alarm when D1 says the run is not running', async () => {
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
    expect(storageSetAlarm).not.toHaveBeenCalled()
  })

  it('mirrors D1 errored status to local DO state when a later alarm wakes', async () => {
    selectRows.set('sequence_runs', [{ status: 'errored' }])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        status: 'errored',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('mirrors the next step index to D1 after a successful send', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ current_step_index: 1 }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('schedules the next step at the next allowed send time', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T21:30:00.000Z')) // 4:30 PM America/Chicago
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    try {
      await instance.alarm()
    } finally {
      nowSpy.mockRestore()
    }

    expect(resendSend).toHaveBeenCalledOnce()
    expect(storageSetAlarm).toHaveBeenCalledWith(Date.parse('2026-06-02T13:00:00.000Z'))
  })

  it('sends each step with a deterministic provider idempotency key', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'sequencer:run_1:0',
      }),
    )
  })

  it('defers an alarm that wakes outside Central send hours without sending', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T05:00:00.000Z')) // 12:00 AM America/Chicago
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    try {
      await instance.alarm()
    } finally {
      nowSpy.mockRestore()
    }

    expect(resendSend).not.toHaveBeenCalled()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
    expect(storageSetAlarm).toHaveBeenCalledWith(Date.parse('2026-06-01T13:00:00.000Z'))
    expect(storagePut).not.toHaveBeenCalledWith(
      'state',
      expect.objectContaining({ currentStepIndex: 1 }),
    )
  })

  it('uses the product-scoped contact timezone when deferring outside send hours', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('contact_products', [
      {
        contact_id: 'contact_1',
        product_id: 'prod_1',
        first_name: 'Scoped',
        last_name: null,
        properties: { timezone: 'America/Los_Angeles' },
      },
    ])
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T12:00:00.000Z')) // 5:00 AM America/Los_Angeles
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    try {
      await instance.alarm()
    } finally {
      nowSpy.mockRestore()
    }

    expect(resendSend).not.toHaveBeenCalled()
    expect(storageSetAlarm).toHaveBeenCalledWith(Date.parse('2026-06-01T15:00:00.000Z'))
  })

  it('errors instead of sending when the stored sequence belongs to a different product', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({
        productId: 'prod_floriva_web',
        productSlug: 'floriva-web',
        sequenceSlug: 'demo-sequence',
        sequenceVersion: 1,
      }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ status: 'errored' }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        status: 'errored',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
  })

  it('creates the Resend adapter with the product configured secret name', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const testEnv = env()
    const instance = new SequenceRunDO(durableObjectState() as never, testEnv as never)

    await instance.alarm()

    expect(createResendAdapter).toHaveBeenCalledWith(
      testEnv,
      'camaudit',
      'RESEND_API_KEY_CAMAUDIT_ROTATED',
    )
  })

  it('keeps provider idempotency keys independent of unbounded YAML step ids', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'x'.repeat(300), delay: '0m', subject: 'Hello', template: 'demo-template' },
          ],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    const idempotencyKey = resendSend.mock.calls[0]?.[0]?.idempotencyKey
    expect(idempotencyKey).toBe('sequencer:run_1:0')
    expect(idempotencyKey.length).toBeLessThanOrEqual(256)
  })

  it('mirrors the completed step index to D1 when the sequence finishes', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'completed',
        current_step_index: 1,
        completed_at: expect.any(String),
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        status: 'completed',
      }),
    )
    expect(storageSetAlarm).not.toHaveBeenCalled()
  })

  it('records the rendered template slug when reserving a step row', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(renderEmailForTemplate).toHaveBeenCalledWith('demo-template', expect.anything())
    expect(inserts).toContainEqual({
      table: steps,
      values: expect.objectContaining({
        run_id: 'run_1',
        step_index: 0,
        template_slug: 'demo-template',
        status: 'pending',
      }),
    })
  })

  it('renders the template with the product-scoped contact first name', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('contacts', [
      { email: 'user@example.com', first_name: 'Global', last_name: 'Name' },
    ])
    selectRows.set('contact_products', [
      {
        contact_id: 'contact_1',
        product_id: 'prod_1',
        first_name: 'Scoped',
        last_name: 'Name',
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(renderEmailForTemplate).toHaveBeenCalledWith(
      'demo-template',
      expect.objectContaining({
        firstName: 'Scoped',
      }),
    )
  })

  it('archives rendered HTML to R2 and records the archive key on the message row', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    renderEmailForTemplate.mockResolvedValue({
      html: '<p>Archived body</p>',
      text: 'Archived body',
    })
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(logsBucketPut).toHaveBeenCalledWith(
      'emails/camaudit/demo-sequence/run_1/0-msg_1.html',
      '<p>Archived body</p>',
      expect.objectContaining({
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      }),
    )
    expect(inserts).toContainEqual({
      table: messages,
      values: expect.objectContaining({
        resend_message_id: 'msg_1',
        html_r2_key: null,
      }),
    })
    expect(updates).toContainEqual({
      table: messages,
      values: expect.objectContaining({
        html_r2_key: 'emails/camaudit/demo-sequence/run_1/0-msg_1.html',
      }),
    })
  })

  it('exits the run and deletes the alarm when suppression is active before sending', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    checkSuppression.mockResolvedValue({
      suppressed: true,
      reason: 'unsubscribed',
      scope: 'product',
    })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T05:00:00.000Z'))
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    try {
      await instance.alarm()
    } finally {
      nowSpy.mockRestore()
    }

    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'exited',
        completed_at: expect.any(String),
      }),
    })
    expect(updates).not.toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ current_step_index: 1 }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
    expect(storageSetAlarm).not.toHaveBeenCalled()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('exits the run for firewall blocks even outside send hours', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    checkFirewall.mockResolvedValue({
      blocked: true,
      reason: 'partner_collision',
    })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T05:00:00.000Z'))
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    try {
      await instance.alarm()
    } finally {
      nowSpy.mockRestore()
    }

    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'exited',
        completed_at: expect.any(String),
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
    expect(storageSetAlarm).not.toHaveBeenCalled()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('exits the run and deletes the alarm when the synced sequence is inactive before sending', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        is_active: false,
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'exited',
        completed_at: expect.any(String),
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
    expect(storageSetAlarm).not.toHaveBeenCalled()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
    expect(trackMetric).toHaveBeenCalledWith(expect.anything(), {
      name: 'send.skipped',
      dims: {
        product: 'camaudit',
        sequence: 'demo-sequence',
        step: 'step_1',
        reason: 'sequence_inactive',
      },
    })
  })

  it('errors the run instead of sending when the synced sequence version changed', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        version: 2,
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ sequenceVersion: 1 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'errored',
        completed_at: expect.any(String),
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        status: 'errored',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
    expect(storageSetAlarm).not.toHaveBeenCalled()
    expect(renderEmailForTemplate).not.toHaveBeenCalled()
  })

  it('does not save terminal local state or delete alarms when terminal D1 status writes fail', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        version: 2,
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    updateShouldThrow = (table, values) =>
      table.__name === 'sequence_runs' && values.status === 'errored'
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ sequenceVersion: 1 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(storagePut).not.toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        status: 'errored',
      }),
    )
    expect(storageDeleteAlarm).not.toHaveBeenCalled()
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        status: 'running',
        retryCount: 1,
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('does not strand a cancelled run locally when the terminal D1 status write fails', async () => {
    updateShouldThrow = (table, values) =>
      table.__name === 'sequence_runs' && values.status === 'exited'
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'operator' }),
      }),
    )

    expect(res.status).toBe(500)
    expect(storagePut).not.toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).not.toHaveBeenCalled()
  })

  it('mirrors the current step index to D1 when the run is already past the definition end', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ currentStepIndex: 4 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'completed',
        current_step_index: 4,
        completed_at: expect.any(String),
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 4,
        status: 'completed',
      }),
    )
    expect(storageSetAlarm).not.toHaveBeenCalled()
  })

  it('does not downgrade a sent step when the progress mirror write fails', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    updateShouldThrow = (table, values) =>
      table.__name === 'sequence_runs' && values.current_step_index === 1
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(updates).toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'sent' }),
    })
    expect(updates).not.toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'pending' }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('keeps the reserved step retryable when the pre-step message write fails', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    insertShouldThrow = (table) => table.__name === 'messages'
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(updates).not.toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'sent' }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        retryCount: 1,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('treats an existing message row for a pending step as sent before provider calls', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('steps', [
      {
        id: 'step_1',
        status: 'pending',
        messageId: null,
        sentAt: null,
      },
    ])
    selectRows.set('messages', [
      {
        id: 'message_1',
        stepId: 'step_1',
        resendMessageId: 'msg_already_sent',
        sentAt: '2026-05-27T12:00:00.000Z',
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(updates).toContainEqual({
      table: steps,
      values: expect.objectContaining({
        status: 'sent',
        message_id: 'msg_already_sent',
        sent_at: '2026-05-27T12:00:00.000Z',
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        currentStepIndex: 1,
        status: 'completed',
      }),
    )
  })

  it('creates a pending step row when retryable execution fails before a step row is reserved', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('products', [])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(inserts).toContainEqual({
      table: steps,
      values: expect.objectContaining({
        run_id: 'run_1',
        step_index: 0,
        template_slug: 'demo-template',
        variant: null,
        status: 'pending',
        error: 'Product not found: prod_1',
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        retryCount: 1,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('creates a failed step row when pre-reservation execution exhausts retries', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('products', [])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ retryCount: 3 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(inserts).toContainEqual({
      table: steps,
      values: expect.objectContaining({
        run_id: 'run_1',
        step_index: 0,
        template_slug: 'demo-template',
        variant: null,
        status: 'failed',
        error: 'Product not found: prod_1',
      }),
    })
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({
        status: 'errored',
        completed_at: expect.any(String),
      }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 0,
        retryCount: 3,
        status: 'errored',
      }),
    )
    expect(storageSetAlarm).not.toHaveBeenCalled()
  })

  it('logs and tracks dead-letter queue failures after retries are exhausted', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('products', [])
    deadLetterSend.mockRejectedValue(new Error('queue unavailable'))
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ retryCount: 3 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(deadLetterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'step_exhausted',
        run_id: 'run_1',
        step_index: 0,
        error: 'Product not found: prod_1',
      }),
    )
    const alarmLogger = createLogger.mock.results[0]?.value
    expect(alarmLogger.error).toHaveBeenCalledWith(
      'Failed to send exhausted step to dead-letter queue',
      {
        run_id: 'run_1',
        step_index: '0',
        error: 'queue unavailable',
      },
    )
    expect(trackMetric).toHaveBeenCalledWith(expect.anything(), {
      name: 'dead_letter.failed',
      dims: {
        product: 'camaudit',
        sequence: 'demo-sequence',
        step: '0',
        error: 'queue unavailable',
      },
    })
  })

  it('logs and tracks non-Error dead-letter queue failures after retries are exhausted', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('products', [])
    deadLetterSend.mockRejectedValue('queue unavailable')
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ retryCount: 3 }) as never,
      env() as never,
    )

    await instance.alarm()

    const alarmLogger = createLogger.mock.results[0]?.value
    expect(alarmLogger.error).toHaveBeenCalledWith(
      'Failed to send exhausted step to dead-letter queue',
      {
        run_id: 'run_1',
        step_index: '0',
        error: 'queue unavailable',
      },
    )
    expect(trackMetric).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'dead_letter.failed',
        dims: expect.objectContaining({ error: 'queue unavailable' }),
      }),
    )
  })

  it('does not target sent duplicate rows when recording a step error', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('steps', [{ id: 'step_pending', status: 'pending' }])
    renderEmailForTemplate.mockRejectedValue(new Error('render failed'))
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    const pendingErrorUpdateIndex = updates.findIndex(
      (update) =>
        update.table === steps &&
        update.values.status === 'pending' &&
        update.values.error === 'render failed',
    )
    expect(pendingErrorUpdateIndex).toBeGreaterThanOrEqual(0)
    expect(updateWheres[pendingErrorUpdateIndex]).toEqual({
      table: steps,
      where: expect.objectContaining({
        op: 'and',
        conditions: expect.arrayContaining([{ op: 'ne', column: steps.status, value: 'sent' }]),
      }),
    })
  })

  it('backfills a missing message row when retrying an already-sent step', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('steps', [
      {
        id: 'step_1',
        status: 'sent',
        messageId: 'msg_1',
        sentAt: '2026-05-19T19:00:00.000Z',
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ retryCount: 1 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(inserts).toContainEqual({
      table: messages,
      values: expect.objectContaining({
        step_id: 'step_1',
        contact_id: 'contact_1',
        product_id: 'prod_1',
        resend_message_id: 'msg_1',
        subject: 'Hello',
        from_email: 'hello@example.com',
        html_r2_key: 'emails/camaudit/demo-sequence/run_1/0-msg_1.html',
        sent_at: '2026-05-19T19:00:00.000Z',
      }),
    })
    expect(logsBucketPut).toHaveBeenCalledWith(
      'emails/camaudit/demo-sequence/run_1/0-msg_1.html',
      '<p>Hello</p>',
      { httpMetadata: { contentType: 'text/html; charset=utf-8' } },
    )
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        retryCount: 0,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('advances an already-sent step even when rendering now fails', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            { id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('steps', [
      {
        id: 'step_1',
        status: 'sent',
        messageId: 'msg_1',
        sentAt: '2026-05-19T19:00:00.000Z',
      },
    ])
    renderEmailForTemplate.mockRejectedValue(new Error('render failed'))
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(
      durableObjectState({ retryCount: 1 }) as never,
      env() as never,
    )

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        retryCount: 0,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
    expect(updates).not.toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ status: 'errored' }),
    })
  })

  it('exits replied sequences when the runtime event is reply_received', async () => {
    selectRows.set('sequences', [
      {
        exit_conditions: [{ event: 'replied' }],
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'reply_received' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ status: 'exited' }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
  })

  it('exits immediately on unsubscribe events even when sequence exit conditions omit unsubscribe', async () => {
    selectRows.set('sequences', [
      {
        exit_conditions: [],
        definition: {
          steps: [{ id: 'step_1', delay: '0m', subject: 'Hello', template: 'demo-template' }],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'unsubscribed' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(updates).toContainEqual({
      table: sequence_runs,
      values: expect.objectContaining({ status: 'exited' }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        status: 'exited',
      }),
    )
    expect(storageDeleteAlarm).toHaveBeenCalledOnce()
  })

  it('matches replied skip_if conditions against reply_received events', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { replied: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('events', [
      {
        type: 'reply_received',
        payload: { email: 'user@example.com', product: 'camaudit' },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('matches replied skip_if conditions after a direct reply_received DO event', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        exit_conditions: [],
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { replied: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    const res = await instance.fetch(
      new Request('https://do/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'reply_received' }),
      }),
    )
    await instance.alarm()

    expect(res.status).toBe(200)
    expect(resendSend).not.toHaveBeenCalled()
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        status: 'running',
        receivedEvents: ['reply_received'],
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('does not match skip_if events recorded for another product', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { reply_received: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('events', [
      {
        type: 'reply_received',
        payload: { email: 'user@example.com', product: 'floriva-web' },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).toHaveBeenCalledOnce()
    expect(updates).toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'sent' }),
    })
  })

  it('matches skip_if events recorded for the same product', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { reply_received: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('events', [
      {
        type: 'reply_received',
        payload: { email: 'user@example.com', product: 'camaudit' },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(updates).not.toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'sent' }),
    })
    expect(storagePut).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({
        runId: 'run_1',
        currentStepIndex: 1,
        status: 'running',
      }),
    )
    expect(storageSetAlarm).toHaveBeenCalledOnce()
  })

  it('matches skip_if events after many unrelated events because filtering happens in SQL', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { reply_received: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('events', [
      ...Array.from({ length: 250 }, (_, index) => ({
        type: 'reply_received',
        payload: { email: `other-${index}@example.com`, product: 'floriva-web' },
      })),
      {
        type: 'reply_received',
        payload: { email: 'user@example.com', product: 'camaudit' },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).not.toHaveBeenCalled()
    expect(rawQueries[0]).toEqual(
      expect.objectContaining({
        binds: ['reply_received', 'user@example.com', 'camaudit'],
      }),
    )
    expect(rawQueries[0].sql).toContain("json_extract(payload, '$.email') = ?")
    expect(rawQueries[0].sql).toContain("json_extract(payload, '$.product') = ?")
  })

  it('does not treat malformed product values as legacy skip_if events', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { reply_received: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('events', [
      {
        type: 'reply_received',
        payload: { email: 'user@example.com', product: null },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).toHaveBeenCalledOnce()
    expect(updates).toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'sent' }),
    })
  })

  it('does not treat productless internal events as matching product-scoped skip_if conditions', async () => {
    selectRows.set('sequence_runs', [{ status: 'running' }])
    selectRows.set('sequences', [
      {
        product_id: 'prod_1',
        definition: {
          steps: [
            {
              id: 'step_1',
              delay: '0m',
              subject: 'Hello',
              template: 'demo-template',
              skip_if: { reply_received: true },
            },
            { id: 'step_2', delay: '1h', subject: 'Next', template: 'demo-template' },
          ],
        },
      },
    ])
    selectRows.set('events', [
      {
        type: 'reply_received',
        payload: { email: 'user@example.com' },
      },
    ])
    const { SequenceRunDO } = await import('../durable-objects/sequence-run')
    const instance = new SequenceRunDO(durableObjectState() as never, env() as never)

    await instance.alarm()

    expect(resendSend).toHaveBeenCalledOnce()
    expect(updates).toContainEqual({
      table: steps,
      values: expect.objectContaining({ status: 'sent' }),
    })
  })
})
