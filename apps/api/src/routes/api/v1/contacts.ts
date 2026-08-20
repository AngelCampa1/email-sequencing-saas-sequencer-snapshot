import { contact_products, contacts, createDb, products } from '@sequencer/db'
import { EmailSchema, UpsertContactSchema } from '@sequencer/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { audit } from '../../../lib/audit'
import { createOrLoadContactByEmail } from '../../../lib/contact-upsert'
import { checkFirewall } from '../../../lib/firewall'
import { createLogger } from '../../../lib/observability'
import { requireProductApiClientContext } from '../../../lib/product-api-auth'
import { checkSuppression } from '../../../lib/suppression'
import type { Env } from '../../../types'

export const contactsRoute = new Hono<{ Bindings: Env }>()

type ContactTimelineEntry = {
  kind: string
  at: string
  run_id?: string
  step_id?: string
  message_id?: string | null
  event_id?: string
  status?: string
  type?: string
}

// POST /api/v1/contacts - upsert by email, set product association
contactsRoute.post('/', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient

  const callerProduct = apiClient.productSlug
  const actor = `api:${apiClient.clientId}`
  const logger = createLogger(c.env, { actor })
  const body = await c.req.json().catch(() => null)
  const parsed = UpsertContactSchema.safeParse(body)
  if (!parsed.success)
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)

  const { email, first_name, last_name, properties, product } = parsed.data
  const normalizedEmail = email.toLowerCase()
  const db = createDb(c.env.DB)

  if (callerProduct !== product) {
    return c.json(
      { error: 'forbidden_product', detail: 'Token is not authorized for this product' },
      403,
    )
  }

  // Find product
  const [prod] = await db.select().from(products).where(eq(products.slug, product)).limit(1)
  if (!prod) return c.json({ error: 'Product not found' }, 404)

  const suppCheck = await checkSuppression(c.env, normalizedEmail, prod.id)
  if (suppCheck.suppressed) {
    logger.info('Contact upsert blocked: suppressed', { email: normalizedEmail, product })
    return c.json({ error: 'Contact is suppressed', scope: suppCheck.scope }, 422)
  }

  const firewallCheck = await checkFirewall(c.env, normalizedEmail, prod.id)
  if (firewallCheck.blocked) {
    logger.warn('Contact upsert blocked: firewall', { email: normalizedEmail, product })
    await audit(c.env, actor, 'contact.blocked', 'contact', null, null, {
      email: normalizedEmail,
      product,
      reason: 'firewall',
    })
    return c.json({ error: 'firewall_block', detail: firewallCheck.reason }, 409)
  }

  // Upsert contact
  let [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, normalizedEmail))
    .limit(1)
  let isNew = !contact
  let existingAssociation: Array<{ status?: string }> = []
  const profileValues = productProfileValues(parsed.data)

  if (!isNew) {
    existingAssociation = await db
      .select()
      .from(contact_products)
      .where(
        and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, prod.id)),
      )
      .limit(1)
    const associationStatus = existingAssociation[0]?.status
    if (associationStatus && associationStatus !== 'active') {
      return c.json({ error: 'Contact is not active for this product' }, 422)
    }
  }

  if (isNew) {
    const id = crypto.randomUUID()
    const created = await createOrLoadContactByEmail(db, {
      id,
      email: normalizedEmail,
      first_name: profileValues.first_name,
      last_name: profileValues.last_name,
      properties,
    })
    contact = created.contact
    isNew = created.isNew
  } else {
    await db
      .update(contacts)
      .set({ updated_at: new Date().toISOString() })
      .where(eq(contacts.id, contact.id))
  }

  // Ensure contact_products association
  if (existingAssociation.length === 0) {
    await db
      .insert(contact_products)
      .values({ contact_id: contact.id, product_id: prod.id, ...profileValues })
      .onConflictDoNothing()
    const [association] = await db
      .select({ status: contact_products.status })
      .from(contact_products)
      .where(
        and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, prod.id)),
      )
      .limit(1)
    if (association?.status && association.status !== 'active') {
      return c.json({ error: 'Contact is not active for this product' }, 422)
    }
  } else if (Object.keys(profileValues).length > 0) {
    await db
      .update(contact_products)
      .set({ ...profileValues, updated_at: new Date().toISOString() })
      .where(
        and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, prod.id)),
      )
  }

  await audit(
    c.env,
    actor,
    isNew ? 'contact.created' : 'contact.updated',
    'contact',
    contact.id,
    null,
    { email: normalizedEmail, product },
  )
  logger.info(isNew ? 'Contact created' : 'Contact updated', { email: normalizedEmail })
  return c.json({ id: contact.id, email: normalizedEmail, is_new: isNew }, isNew ? 201 : 200)
})

// GET /api/v1/contacts/:email - full timeline
contactsRoute.get('/:email', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient

  const callerProduct = apiClient.productSlug
  const email = parseEmailPathParam(c.req.param('email'))
  if (!email) return c.json({ error: 'Invalid email parameter' }, 400)
  const db = createDb(c.env.DB)

  const [contact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1)
  if (!contact) return c.json({ error: 'Contact not found' }, 404)

  const [prod] = await db.select().from(products).where(eq(products.slug, callerProduct)).limit(1)
  if (!prod) return c.json({ error: 'not_authenticated' }, 401)

  const associations = await db
    .select()
    .from(contact_products)
    .where(
      and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, prod.id)),
    )
  if (associations.length === 0) return c.json({ error: 'Contact not found' }, 404)
  const productProfile = associations[0]

  const contactRuns = (
    await queryRows<Record<string, any>>(
      c.env.DB,
      `
    SELECT r.*
    FROM seq_sequence_runs r
    WHERE r.contact_id = ? AND r.product_id = ?
    ORDER BY r.started_at DESC
    LIMIT 100
  `,
      contact.id,
      prod.id,
    )
  ).map(normalizeRunRow)
  const runIds = new Set(contactRuns.map((run) => run.id))
  const scopedSteps =
    runIds.size === 0
      ? []
      : await queryRows<Record<string, any>>(
          c.env.DB,
          `
      SELECT *
      FROM seq_steps
      WHERE run_id IN (${placeholders(runIds.size)})
      ORDER BY run_id ASC, step_index ASC
      LIMIT 500
    `,
          ...runIds,
        )

  const contactMessages = await queryRows<Record<string, any>>(
    c.env.DB,
    `
    SELECT *
    FROM seq_messages
    WHERE contact_id = ? AND product_id = ?
    ORDER BY sent_at DESC
    LIMIT 500
  `,
    contact.id,
    prod.id,
  )
  const messageIds = new Set(
    contactMessages
      .map((message) => message.resend_message_id)
      .filter(
        (messageId): messageId is string => typeof messageId === 'string' && messageId.length > 0,
      ),
  )

  const providerEvents =
    messageIds.size === 0
      ? []
      : (
          await queryRows<Record<string, any>>(
            c.env.DB,
            `
      SELECT *
      FROM seq_events
      WHERE provider = 'resend'
        AND message_id IN (${placeholders(messageIds.size)})
      ORDER BY received_at ASC
      LIMIT 1000
    `,
            ...messageIds,
          )
        ).map(normalizeEventRow)

  const internalEvents = (
    await queryRows<Record<string, any>>(
      c.env.DB,
      `
    SELECT *
    FROM seq_events
    WHERE provider = 'internal'
      AND json_extract(payload, '$.email') = ?
      AND json_extract(payload, '$.product') = ?
    ORDER BY received_at ASC
    LIMIT 500
  `,
      email,
      callerProduct,
    )
  ).map(normalizeEventRow)

  const messagesByStepId = new Map(contactMessages.map((message) => [message.step_id, message]))
  const eventsByMessageId = new Map<string, typeof providerEvents>()
  for (const event of providerEvents) {
    if (typeof event.message_id !== 'string') continue
    eventsByMessageId.set(event.message_id, [
      ...(eventsByMessageId.get(event.message_id) ?? []),
      event,
    ])
  }

  const timeline = buildContactTimeline(contactRuns, scopedSteps, contactMessages, [
    ...providerEvents,
    ...internalEvents,
  ])

  return c.json({
    ...contact,
    first_name: productProfile.first_name ?? null,
    last_name: productProfile.last_name ?? null,
    properties: parseJsonField(productProfile.properties) ?? null,
    products: associations,
    runs: contactRuns.map((run) => ({
      ...run,
      steps: scopedSteps
        .filter((step) => step.run_id === run.id)
        .map((step) => {
          const message = messagesByStepId.get(step.id) ?? null
          return {
            ...step,
            message,
            events: message?.resend_message_id
              ? (eventsByMessageId.get(message.resend_message_id) ?? [])
              : [],
          }
        }),
    })),
    messages: contactMessages,
    events: [...providerEvents, ...internalEvents],
    timeline,
  })
})

function buildContactTimeline(
  runs: Array<Record<string, any>>,
  stepRows: Array<Record<string, any>>,
  messageRows: Array<Record<string, any>>,
  eventRows: Array<Record<string, any>>,
): ContactTimelineEntry[] {
  const entries: ContactTimelineEntry[] = []

  for (const run of runs) {
    if (typeof run.started_at === 'string') {
      entries.push({
        kind: 'run.started',
        at: run.started_at,
        run_id: run.id,
        status: run.status,
      })
    }
    if (typeof run.completed_at === 'string') {
      entries.push({
        kind: 'run.completed',
        at: run.completed_at,
        run_id: run.id,
        status: run.status,
      })
    }
  }

  for (const step of stepRows) {
    const at = typeof step.sent_at === 'string' ? step.sent_at : step.scheduled_for
    if (typeof at === 'string') {
      entries.push({
        kind: step.status === 'sent' ? 'step.sent' : `step.${step.status}`,
        at,
        run_id: step.run_id,
        step_id: step.id,
        message_id: step.message_id,
        status: step.status,
      })
    }
  }

  for (const message of messageRows) {
    if (typeof message.sent_at === 'string') {
      entries.push({
        kind: 'message.sent',
        at: message.sent_at,
        step_id: message.step_id,
        message_id: message.resend_message_id,
      })
    }
  }

  for (const event of eventRows) {
    if (typeof event.received_at === 'string') {
      entries.push({
        kind: `event.${event.type}`,
        at: event.received_at,
        event_id: event.id,
        message_id: event.message_id,
        type: event.type,
      })
    }
  }

  return entries.sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      timelineKindRank(a.kind) - timelineKindRank(b.kind) ||
      a.kind.localeCompare(b.kind),
  )
}

function timelineKindRank(kind: string): number {
  if (kind.startsWith('run.')) return 0
  if (kind.startsWith('step.')) return 1
  if (kind.startsWith('message.')) return 2
  if (kind.startsWith('event.')) return 3
  return 4
}

function normalizeRunRow(row: Record<string, any>): Record<string, any> {
  return {
    ...row,
    variant_assignment: parseJsonField(row.variant_assignment),
  }
}

function normalizeEventRow(row: Record<string, any>): Record<string, any> {
  return {
    ...row,
    payload: parseJsonField(row.payload) ?? {},
  }
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch (_) {
    return null
  }
}

function parseEmailPathParam(value: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch (_) {
    return null
  }
  const parsed = EmailSchema.safeParse(decoded)
  return parsed.success ? parsed.data : null
}

function normalizeOptionalName(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function hasField(value: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(value, field)
}

function productProfileValues(value: {
  first_name?: string
  last_name?: string
  properties?: Record<string, unknown>
}): {
  first_name?: string | null
  last_name?: string | null
  properties?: Record<string, unknown>
} {
  const profile: {
    first_name?: string | null
    last_name?: string | null
    properties?: Record<string, unknown>
  } = {}
  if (hasField(value, 'first_name')) profile.first_name = normalizeOptionalName(value.first_name)
  if (hasField(value, 'last_name')) profile.last_name = normalizeOptionalName(value.last_name)
  if (hasField(value, 'properties')) profile.properties = value.properties
  return profile
}

async function queryRows<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<T[]> {
  const statement = db.prepare(sql)
  const result =
    binds.length > 0 ? await statement.bind(...binds).all<T>() : await statement.all<T>()
  return result.results ?? []
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
