import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const checkSuppression = vi.fn()
const checkFirewall = vi.fn()
const ensureListMembership = vi.fn()
const findRunningRunForContact = vi.fn()
const isRunningRunUniqueConflict = vi.fn()
const assignVariant = vi.fn()
const createLogger = vi.fn(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../lib/suppression', () => ({ checkSuppression }))
vi.mock('../lib/firewall', () => ({ checkFirewall }))
vi.mock('../lib/lists', () => ({ ensureListMembership }))
vi.mock('../lib/active-run', () => ({ findRunningRunForContact, isRunningRunUniqueConflict }))
vi.mock('../lib/variant', () => ({ assignVariant }))
vi.mock('../lib/observability', () => ({ createLogger, trackMetric: vi.fn() }))

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

const sequences_table = { __name: 'sequences' }
const contact_products_table = { __name: 'contact_products' }
const sequence_runs_table = { __name: 'sequence_runs' }

type SequenceRow = {
  slug: string
  product_id: string
  version: number
  is_active: boolean
  definition: Record<string, unknown>
  goal?: string | null
}

let mockSequences: SequenceRow[] = []
let mockContactProduct: { status: string } | null = null
let mockInsertError: Error | null = null

const insertValues = vi.fn()
const insertConflict = vi.fn()
const updateSet = vi.fn()
const updateWhere = vi.fn()

vi.mock('@sequencer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sequencer/db')>()
  return {
    ...actual,
    createDb: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn((table: { __name: string }) => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              if (table.__name === 'sequences') return mockSequences
              if (table.__name === 'contact_products')
                return mockContactProduct ? [mockContactProduct] : []
              return []
            }),
          })),
        })),
      })),
      insert: vi.fn((table: { __name: string }) => ({
        values: vi.fn((vals: unknown) => {
          insertValues({ table: table.__name, vals })
          if (table.__name === 'sequence_runs' && mockInsertError) {
            const err = mockInsertError
            mockInsertError = null
            throw err
          }
          return {
            onConflictDoNothing: vi.fn(async () => {
              insertConflict({ table: table.__name, vals })
            }),
          }
        }),
      })),
      update: vi.fn((table: { __name: string }) => ({
        set: vi.fn((vals: unknown) => {
          updateSet({ table: table.__name, vals })
          return {
            where: vi.fn((cond: unknown) => {
              updateWhere({ table: table.__name, cond })
            }),
          }
        }),
      })),
    })),
    // re-export actual schema references so table identity checks work
    sequences: sequences_table,
    contact_products: contact_products_table,
    sequence_runs: sequence_runs_table,
  }
})

// ---------------------------------------------------------------------------
// Env helper
// ---------------------------------------------------------------------------

function makeEnv(
  doFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
): Env & { __doFetch: typeof doFetch } {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
    DB: {} as D1Database,
    SUPPRESSIONS: {
      get: vi.fn(async () => null),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace,
    SESSIONS: {
      get: vi.fn(async () => null),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace,
    ASSETS_BUCKET: { get: vi.fn() } as unknown as R2Bucket,
    ANALYTICS: { writeDataPoint: vi.fn() } as unknown as AnalyticsEngineDataset,
    EVENTS_QUEUE: { send: vi.fn() } as unknown as Queue,
    SEQUENCE_RUN: {
      idFromName: vi.fn((id: string) => ({ id })),
      get: vi.fn(() => ({ fetch: doFetch })),
    } as unknown as DurableObjectNamespace,
    __doFetch: doFetch,
  } as unknown as Env & { __doFetch: typeof doFetch }
}

// ---------------------------------------------------------------------------
// Shared params
// ---------------------------------------------------------------------------

const BASE_PARAMS = {
  contactId: 'contact_1',
  contactEmail: 'user@example.com',
  productId: 'prod_camaudit',
  productSlug: 'camaudit',
  productName: 'CAMAudit',
  event: 'signup',
  properties: {},
  source: 'transition' as const,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transitionOnEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSequences = []
    mockContactProduct = { status: 'active' }
    mockInsertError = null

    checkSuppression.mockResolvedValue({ suppressed: false })
    checkFirewall.mockResolvedValue({ blocked: false })
    findRunningRunForContact.mockResolvedValue(null)
    isRunningRunUniqueConflict.mockReturnValue(false)
    assignVariant.mockReturnValue('control')
    ensureListMembership.mockResolvedValue({ list_id: 'list_1', member_id: 'member_1' })
  })

  it('enrolls contact when event matches a sequence enroll.trigger and no run is active', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [], goal: 'onboarding' },
        goal: 'onboarding',
      },
    ]

    const doFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const env = makeEnv(doFetch)

    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(1)
    // DO /start was called with the correct sequenceSlug
    expect(doFetch).toHaveBeenCalledOnce()
    const callArg = (doFetch.mock.calls as unknown as Array<[Request]>)[0]?.[0]
    expect(callArg?.url).toMatch(/\/start$/)
    const body = await callArg?.json()
    expect(body).toMatchObject({
      contactId: 'contact_1',
      contactEmail: 'user@example.com',
      productId: 'prod_camaudit',
      productSlug: 'camaudit',
      sequenceSlug: 'camaudit-onboarding',
      sequenceVersion: 1,
    })
    // sequence_runs row was inserted
    const seqInsert = insertValues.mock.calls.find((c) => c[0].table === 'sequence_runs')
    expect(seqInsert).toBeDefined()
    expect((seqInsert as [{ table: string; vals: Record<string, unknown> }])[0].vals).toMatchObject(
      {
        contact_id: 'contact_1',
        product_id: 'prod_camaudit',
        sequence_slug: 'camaudit-onboarding',
        enrollment_source: 'transition',
      },
    )
    // list membership ensured
    expect(ensureListMembership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ listSlug: 'camaudit-onboarding' }),
    )
  })

  it('does not start a run when no sequence has a matching enroll.trigger', async () => {
    mockSequences = [
      {
        slug: 'camaudit-nurture',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'lead_captured' }, variants: [], goal: 'nurture' },
        goal: 'nurture',
      },
    ]

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, { ...BASE_PARAMS, event: 'signup' })

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('does not start a duplicate run when the contact already has a running run', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
      },
    ]
    findRunningRunForContact.mockResolvedValue({
      id: 'existing-run',
      contact_id: 'contact_1',
      product_id: 'prod_camaudit',
      sequence_slug: 'camaudit-onboarding',
      status: 'running',
      started_at: '2026-01-01T00:00:00.000Z',
    })

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('does not start a run when the contact is suppressed', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
      },
    ]
    checkSuppression.mockResolvedValue({
      suppressed: true,
      scope: 'product',
      reason: 'unsubscribed',
    })

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('does not start a run when the firewall blocks the contact (camaudit/floriva-web pair)', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
      },
    ]
    checkFirewall.mockResolvedValue({
      blocked: true,
      reason: 'Firewall: contact is associated with partner product prod_floriva_web',
    })

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('returns no runs and swallows the error when the sequences query fails', async () => {
    const { createDb } = await import('@sequencer/db')
    ;(createDb as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              throw new Error('D1 unavailable')
            }),
          })),
        })),
      })),
    }))

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('skips the sequence when a unique conflict is raised on run insert', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
      },
    ]
    mockInsertError = new Error('UNIQUE constraint failed')
    isRunningRunUniqueConflict.mockReturnValue(true)

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    // booting the DO must not happen after a losing insert race
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('rethrows-then-swallows a non-conflict insert error without starting a run', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
      },
    ]
    mockInsertError = new Error('disk full')
    isRunningRunUniqueConflict.mockReturnValue(false)

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('skips when the contact_product association is not active', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
      },
    ]
    mockContactProduct = { status: 'unsubscribed' }

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    expect(env.SEQUENCE_RUN.idFromName).not.toHaveBeenCalled()
  })

  it('assigns a variant when the sequence declares variants', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: {
          enroll: { trigger: 'signup' },
          variants: [
            { id: 'a', weight: 50 },
            { id: 'b', weight: 50 },
          ],
          goal: 'onboarding',
        },
        goal: 'onboarding',
      },
    ]
    assignVariant.mockReturnValue('b')

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(1)
    expect(assignVariant).toHaveBeenCalled()
    const seqInsert = insertValues.mock.calls.find((c) => c[0].table === 'sequence_runs')
    expect(
      (seqInsert as [{ table: string; vals: Record<string, unknown> }])[0].vals.variant_assignment,
    ).toEqual({ variant_id: 'b' })
  })

  it('still enrolls when list membership fails (non-fatal)', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [], goal: 'onboarding' },
        goal: 'onboarding',
      },
    ]
    ensureListMembership.mockRejectedValue(new Error('list write failed'))

    const env = makeEnv()
    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(1)
  })

  it('marks the run errored when the DO /start returns a non-2xx response', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
        goal: 'onboarding',
      },
    ]
    const doFetch = vi.fn(async () => new Response('boom', { status: 500 }))
    const env = makeEnv(doFetch)

    const { transitionOnEvent } = await import('../lib/sequence-transition')
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    const update = updateSet.mock.calls.find((c) => c[0].table === 'sequence_runs')
    expect((update as [{ table: string; vals: Record<string, unknown> }])[0].vals.status).toBe(
      'errored',
    )
  })

  it('skips a sequence but continues others when one DO /start call fails', async () => {
    mockSequences = [
      {
        slug: 'camaudit-onboarding',
        product_id: 'prod_camaudit',
        version: 1,
        is_active: true,
        definition: { enroll: { trigger: 'signup' }, variants: [] },
        goal: 'onboarding',
      },
    ]

    // first call (for the one sequence) throws
    const doFetch = vi.fn(async () => {
      throw new Error('DO unavailable')
    })
    const env = makeEnv(doFetch)

    const { transitionOnEvent } = await import('../lib/sequence-transition')
    // should not throw - failure is swallowed
    const result = await transitionOnEvent(env, BASE_PARAMS)

    expect(result.startedRuns).toHaveLength(0)
    // the run row was marked errored
    const update = updateSet.mock.calls.find((c) => c[0].table === 'sequence_runs')
    expect(update).toBeDefined()
    expect((update as [{ table: string; vals: Record<string, unknown> }])[0].vals.status).toBe(
      'errored',
    )
  })
})
