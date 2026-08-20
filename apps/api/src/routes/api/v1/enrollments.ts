import {
  contact_products,
  contacts,
  createDb,
  products,
  sequence_runs,
  sequences,
} from '@sequencer/db'
import { EnrollmentRequestSchema } from '@sequencer/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { findRunningRunForContact, isRunningRunUniqueConflict } from '../../../lib/active-run'
import { audit } from '../../../lib/audit'
import { createOrLoadContactByEmail } from '../../../lib/contact-upsert'
import { checkFirewall } from '../../../lib/firewall'
import { ensureListMembership } from '../../../lib/lists'
import { createLogger, trackMetric } from '../../../lib/observability'
import { requireProductApiClientContext } from '../../../lib/product-api-auth'
import { checkSuppression } from '../../../lib/suppression'
import { assignVariant } from '../../../lib/variant'
import type { Env } from '../../../types'

export const enrollmentsRoute = new Hono<{ Bindings: Env }>()

enrollmentsRoute.post('/', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient

  const callerProduct = apiClient.productSlug
  const actor = `api:${apiClient.clientId}`
  const logger = createLogger(c.env, { actor })
  const body = await c.req.json().catch(() => null)
  const parsed = EnrollmentRequestSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)
  }

  const { email, sequence_slug, properties, source } = parsed.data
  const db = createDb(c.env.DB)

  // Load sequence
  const [seq] = await db.select().from(sequences).where(eq(sequences.slug, sequence_slug)).limit(1)
  if (!seq || !seq.is_active) {
    return c.json({ error: 'Sequence not found or inactive' }, 404)
  }

  // Load product
  const [product] = await db.select().from(products).where(eq(products.id, seq.product_id)).limit(1)
  if (!product) {
    return c.json({ error: 'Product not found' }, 404)
  }

  if (callerProduct !== product.slug) {
    return c.json(
      { error: 'forbidden_product', detail: 'Token is not authorized for this sequence' },
      403,
    )
  }

  const normalizedEmail = email.toLowerCase()

  // Suppression check
  const suppCheck = await checkSuppression(c.env, normalizedEmail, product.id)
  if (suppCheck.suppressed) {
    logger.info('Enrollment blocked: suppressed', {
      email: normalizedEmail,
      sequence: sequence_slug,
    })
    return c.json({ error: 'Contact is suppressed', scope: suppCheck.scope }, 422)
  }

  // Firewall check
  const firewallCheck = await checkFirewall(c.env, normalizedEmail, product.id)
  if (firewallCheck.blocked) {
    logger.warn('Enrollment blocked: firewall', { email: normalizedEmail, target: product.id })
    await audit(c.env, actor, 'enrollment.blocked', 'enrollment', null, null, {
      email,
      sequence_slug,
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
  if (!contact) {
    const newId = crypto.randomUUID()
    ;({ contact } = await createOrLoadContactByEmail(db, {
      id: newId,
      email: normalizedEmail,
      properties,
    }))
  }

  // Ensure contact_product association
  const existing = await db
    .select()
    .from(contact_products)
    .where(
      and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, product.id)),
    )
    .limit(1)

  if (existing.length === 0) {
    await db
      .insert(contact_products)
      .values({ contact_id: contact.id, product_id: product.id, properties })
      .onConflictDoNothing()
    const [association] = await db
      .select({ status: contact_products.status })
      .from(contact_products)
      .where(
        and(
          eq(contact_products.contact_id, contact.id),
          eq(contact_products.product_id, product.id),
        ),
      )
      .limit(1)
    if (association?.status && association.status !== 'active') {
      return c.json({ error: 'Contact is not active for this product' }, 422)
    }
  } else if (existing[0].status !== 'active') {
    return c.json({ error: 'Contact is not active for this product' }, 422)
  }

  // A contact can only have one running sequence per product.
  const existingRun = await findRunningRunForContact(db, contact.id, product.id)
  if (existingRun) {
    return c.json({ run_id: existingRun.id, status: 'already_running' }, 200)
  }

  // Assign variant
  const seqDef = seq.definition as any
  const variantId =
    seqDef.variants?.length > 0 ? assignVariant(seqDef.variants, normalizedEmail) : null

  // Add contact to the per-product, per-goal list derived from this sequence
  try {
    const listSlug = `${product.slug}-${(seqDef.goal as string | undefined) ?? 'all'}`
    const listName = `${product.name}: ${(seqDef.goal as string | undefined) ?? 'All'}`
    await ensureListMembership(db, {
      productId: product.id,
      listSlug,
      listName,
      contactId: contact.id,
      source: 'enrollment',
    })
  } catch (err) {
    logger.warn('List membership failed (non-fatal)', { error: (err as Error).message })
  }

  // Create run
  const runId = crypto.randomUUID()
  try {
    await db.insert(sequence_runs).values({
      id: runId,
      contact_id: contact.id,
      product_id: product.id,
      sequence_slug,
      sequence_version: seq.version,
      enrollment_source: source ?? 'api',
      variant_assignment: variantId ? { variant_id: variantId } : null,
    })
  } catch (error) {
    if (isRunningRunUniqueConflict(error)) {
      const winningRun = await findRunningRunForContact(db, contact.id, product.id)
      if (winningRun) {
        return c.json({ run_id: winningRun.id, status: 'already_running' }, 200)
      }
    }
    throw error
  }

  // Boot the Durable Object
  const doId = c.env.SEQUENCE_RUN.idFromName(runId)
  const doStub = c.env.SEQUENCE_RUN.get(doId)
  try {
    const startResponse = await doStub.fetch(
      new Request('https://do/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          contactId: contact.id,
          contactEmail: normalizedEmail,
          productId: product.id,
          productSlug: product.slug,
          sequenceSlug: sequence_slug,
          sequenceVersion: seq.version,
          variantId,
        }),
      }),
    )
    if (!startResponse.ok) {
      throw new Error(
        `SequenceRunDO start failed with ${startResponse.status}: ${await startResponse.text()}`,
      )
    }
  } catch (error) {
    await db
      .update(sequence_runs)
      .set({ status: 'errored', completed_at: new Date().toISOString() })
      .where(eq(sequence_runs.id, runId))
    logger.error('Enrollment DO start failed', {
      run_id: runId,
      error: (error as Error).message,
    })
    return c.json(
      {
        error: 'sequence_start_failed',
        detail: 'Durable Object start failed',
      },
      502,
    )
  }

  trackMetric(c.env.ANALYTICS, {
    name: 'enrollment.created',
    dims: { product: product.slug, sequence: sequence_slug, source: source ?? 'api' },
  })

  await audit(c.env, actor, 'enrollment.created', 'sequence_run', runId, null, {
    email,
    sequence_slug,
  })

  logger.info('Enrollment created', {
    run_id: runId,
    email: normalizedEmail,
    sequence: sequence_slug,
  })

  return c.json({ run_id: runId, status: 'enrolled', variant: variantId }, 201)
})
