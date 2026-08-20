import { contacts, createDb, events, products, sequence_runs } from '@sequencer/db'
import { EventRequestSchema } from '@sequencer/shared'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  enqueueInstantlySuppressionJob,
  processInstantlySuppressionJobByKey,
} from '../../../lib/instantly-suppression-jobs'
import { createLogger } from '../../../lib/observability'
import { requireProductApiClientContext } from '../../../lib/product-api-auth'
import { transitionOnEvent } from '../../../lib/sequence-transition'
import type { Env } from '../../../types'

export const eventsRoute = new Hono<{ Bindings: Env }>()
const EVENT_SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000

eventsRoute.post('/', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient
  const callerProduct = apiClient.productSlug

  const logger = createLogger(c.env)
  const body = await c.req.json().catch(() => null)
  const parsed = EventRequestSchema.safeParse(body)
  if (!parsed.success)
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)

  const { email, event, product, properties } = parsed.data
  const normalizedEmail = email.toLowerCase()
  const db = createDb(c.env.DB)
  const idempotencyKey = normalizeIdempotencyKey(c.req.header('Idempotency-Key'))
  const providerEventId = idempotencyKey ? `api:${apiClient.clientId}:${idempotencyKey}` : null

  if (callerProduct !== product) {
    return c.json(
      { error: 'forbidden_product', detail: 'Token is not authorized for this product' },
      403,
    )
  }

  const [callerProductRow] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, callerProduct))
    .limit(1)
  if (!callerProductRow) return c.json({ error: 'unknown_product' }, 400)

  const expectedPayload = { email: normalizedEmail, product, event, properties: properties ?? {} }
  if (providerEventId) {
    const existingEvent = await loadInternalEventByProviderId(db, providerEventId)

    if (existingEvent && !matchesInternalEventPayload(existingEvent, expectedPayload)) {
      return c.json({ error: 'idempotency_key_conflict' }, 409)
    }

    if (
      typeof existingEvent?.sideEffectsCompletedAt === 'string' &&
      existingEvent.sideEffectsCompletedAt.length > 0
    ) {
      return c.json({ ok: true, event, notified_runs: 0, duplicate: true }, 200)
    }
  }

  // Persist the event
  const eventRecord = {
    provider: 'internal' as const,
    provider_event_id: providerEventId,
    type: event,
    payload: { email: normalizedEmail, product, event, properties: properties ?? {} },
    side_effects_started_at: null,
    side_effects_completed_at: null,
  }
  let sideEffectsLeaseStartedAt: string | null = null
  if (providerEventId) {
    await db.insert(events).values(eventRecord).onConflictDoNothing()
    const storedEvent = await loadInternalEventByProviderId(db, providerEventId)
    if (storedEvent && !matchesInternalEventPayload(storedEvent, expectedPayload)) {
      return c.json({ error: 'idempotency_key_conflict' }, 409)
    }
    const claim = await claimInternalEventSideEffects(db, providerEventId)
    if (claim === 'completed') {
      return c.json({ ok: true, event, notified_runs: 0, duplicate: true }, 200)
    }
    if (claim === 'busy') {
      return c.json({ ok: true, event, notified_runs: 0, duplicate: true, in_progress: true }, 200)
    }
    sideEffectsLeaseStartedAt = claim.leaseStartedAt
  } else {
    await db.insert(events).values(eventRecord)
  }

  // Find any active runs for this contact and notify their DOs
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, normalizedEmail))
    .limit(1)
  let notifiedCount = 0
  const failedRuns: string[] = []
  if (contact) {
    const activeRuns = await db
      .select({ id: sequence_runs.id })
      .from(sequence_runs)
      .where(
        and(
          eq(sequence_runs.contact_id, contact.id),
          eq(sequence_runs.product_id, callerProductRow.id),
          eq(sequence_runs.status, 'running'),
        ),
      )

    for (const run of activeRuns) {
      try {
        const doId = c.env.SEQUENCE_RUN.idFromName(run.id)
        const stub = c.env.SEQUENCE_RUN.get(doId)
        const response = await stub.fetch(
          new Request('https://do/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, properties }),
          }),
        )
        if (!response.ok) {
          const responseBody = await response.text().catch(() => '')
          failedRuns.push(run.id)
          logger.warn('Failed to notify DO', {
            run_id: run.id,
            status: response.status,
            body: responseBody,
          })
          continue
        }
        notifiedCount++
      } catch (err) {
        failedRuns.push(run.id)
        logger.warn('Failed to notify DO', { run_id: run.id, error: (err as Error).message })
      }
    }
  }

  // Auto-transition: enroll contact into sequences triggered by this event
  let transitionedRuns: string[] = []
  if (contact && failedRuns.length === 0) {
    try {
      const transitionResult = await transitionOnEvent(c.env, {
        contactId: contact.id,
        contactEmail: normalizedEmail,
        productId: callerProductRow.id,
        productSlug: callerProduct,
        event,
        properties: properties ?? undefined,
        source: 'transition',
      })
      transitionedRuns = transitionResult.startedRuns
    } catch (err) {
      logger.warn('sequence-transition failed (non-fatal)', { error: (err as Error).message })
    }
  }

  logger.info('Event recorded', { email: normalizedEmail, event, product })
  if (isInstantlySuppressionEvent(event)) {
    const suppressionJobKey =
      providerEventId ?? fallbackSuppressionJobKey(product, event, normalizedEmail)
    try {
      await enqueueInstantlySuppressionJob(c.env, {
        key: suppressionJobKey,
        email: normalizedEmail,
        product,
        event,
        properties: properties ?? undefined,
      })
      logger.info('Instantly suppression job queued', {
        email: normalizedEmail,
        product,
        event,
        job_key: suppressionJobKey,
      })
    } catch (err) {
      logger.warn('Instantly suppression job enqueue failed', {
        email: normalizedEmail,
        product,
        event,
        error: (err as Error).message,
      })
    }
    try {
      c.executionCtx.waitUntil(
        processInstantlySuppressionJobByKey(c.env, suppressionJobKey).catch((err) => {
          logger.warn('Instantly suppression job waitUntil failed', {
            email: normalizedEmail,
            product,
            event,
            error: (err as Error).message,
          })
        }),
      )
    } catch (err) {
      logger.info('Instantly suppression job queued without request waitUntil', {
        email: normalizedEmail,
        product,
        event,
        error: (err as Error).message,
      })
    }
  }
  if (failedRuns.length > 0) {
    if (providerEventId) {
      await releaseInternalEventSideEffectsClaim(db, providerEventId, sideEffectsLeaseStartedAt)
    }
    return c.json(
      {
        ok: false,
        error: 'event_delivery_failed',
        event,
        notified_runs: notifiedCount,
        failed_runs: failedRuns,
      },
      207,
    )
  }

  if (providerEventId) {
    const completed = await markInternalEventSideEffectsCompleted(
      db,
      providerEventId,
      sideEffectsLeaseStartedAt,
    )
    if (!completed) {
      const existingEvent = await loadInternalEventByProviderId(db, providerEventId)
      if (
        typeof existingEvent?.sideEffectsCompletedAt === 'string' &&
        existingEvent.sideEffectsCompletedAt.length > 0
      ) {
        return c.json({ ok: true, event, notified_runs: notifiedCount, duplicate: true }, 200)
      }
      logger.error('Product event side-effect completion lease was lost', {
        provider_event_id: providerEventId,
        event,
        product,
      })
      return c.json(
        {
          ok: false,
          error: 'event_completion_failed',
          event,
          notified_runs: notifiedCount,
        },
        503,
      )
    }
  }

  return c.json(
    { ok: true, event, notified_runs: notifiedCount, transitioned_runs: transitionedRuns },
    200,
  )
})

function isInstantlySuppressionEvent(event: string): boolean {
  return event === 'signup_completed' || event === 'paid_conversion'
}

function fallbackSuppressionJobKey(product: string, event: string, email: string): string {
  return `fallback:${product}:${event}:${email}`
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 200)
}

async function loadInternalEventByProviderId(
  db: ReturnType<typeof createDb>,
  providerEventId: string,
): Promise<Record<string, unknown> | undefined> {
  const [existingEvent] = await db
    .select({
      id: events.id,
      type: events.type,
      payload: events.payload,
      sideEffectsStartedAt: events.side_effects_started_at,
      sideEffectsCompletedAt: events.side_effects_completed_at,
    })
    .from(events)
    .where(and(eq(events.provider, 'internal'), eq(events.provider_event_id, providerEventId)))
    .limit(1)
  return existingEvent
}

function matchesInternalEventPayload(
  existingEvent: Record<string, unknown>,
  expectedPayload: {
    email: string
    product: string
    event: string
    properties: Record<string, unknown>
  },
): boolean {
  if (typeof existingEvent.type === 'string' && existingEvent.type !== expectedPayload.event)
    return false
  const payload = existingEvent.payload
  if (!isRecord(payload)) return true
  return (
    payload.email === expectedPayload.email &&
    payload.product === expectedPayload.product &&
    payload.event === expectedPayload.event &&
    stableJson(payload.properties ?? {}) === stableJson(expectedPayload.properties)
  )
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

type InternalEventClaim = { status: 'claimed'; leaseStartedAt: string } | 'completed' | 'busy'

async function claimInternalEventSideEffects(
  db: ReturnType<typeof createDb>,
  providerEventId: string,
): Promise<InternalEventClaim> {
  const now = new Date().toISOString()
  const staleBefore = new Date(Date.now() - EVENT_SIDE_EFFECT_LEASE_MS).toISOString()
  const result = await db
    .update(events)
    .set({ side_effects_started_at: now })
    .where(
      and(
        eq(events.provider, 'internal'),
        eq(events.provider_event_id, providerEventId),
        isNull(events.side_effects_completed_at),
        or(isNull(events.side_effects_started_at), lt(events.side_effects_started_at, staleBefore)),
      ),
    )

  if (writeChangedRows(result) || result === undefined) {
    return { status: 'claimed', leaseStartedAt: now }
  }

  const [existingEvent] = await db
    .select({
      sideEffectsCompletedAt: events.side_effects_completed_at,
    })
    .from(events)
    .where(and(eq(events.provider, 'internal'), eq(events.provider_event_id, providerEventId)))
    .limit(1)

  return typeof existingEvent?.sideEffectsCompletedAt === 'string' &&
    existingEvent.sideEffectsCompletedAt.length > 0
    ? 'completed'
    : 'busy'
}

async function releaseInternalEventSideEffectsClaim(
  db: ReturnType<typeof createDb>,
  providerEventId: string,
  leaseStartedAt: string | null,
): Promise<void> {
  if (!leaseStartedAt) return
  await db
    .update(events)
    .set({ side_effects_started_at: null })
    .where(
      and(
        eq(events.provider, 'internal'),
        eq(events.provider_event_id, providerEventId),
        eq(events.side_effects_started_at, leaseStartedAt),
        isNull(events.side_effects_completed_at),
      ),
    )
}

async function markInternalEventSideEffectsCompleted(
  db: ReturnType<typeof createDb>,
  providerEventId: string,
  leaseStartedAt: string | null,
): Promise<boolean> {
  if (!leaseStartedAt) return true
  const result = await db
    .update(events)
    .set({
      side_effects_completed_at: new Date().toISOString(),
      side_effects_started_at: null,
    })
    .where(
      and(
        eq(events.provider, 'internal'),
        eq(events.provider_event_id, providerEventId),
        eq(events.side_effects_started_at, leaseStartedAt),
        isNull(events.side_effects_completed_at),
      ),
    )
  return writeSucceededOrUnknown(result)
}

function writeChangedRows(result: unknown): boolean {
  if (!isRecord(result)) return false
  const meta = result.meta
  if (isRecord(meta) && typeof meta.changes === 'number') return meta.changes > 0
  if (typeof result.changes === 'number') return result.changes > 0
  return false
}

function writeSucceededOrUnknown(result: unknown): boolean {
  if (result === undefined) return true
  return writeChangedRows(result)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
