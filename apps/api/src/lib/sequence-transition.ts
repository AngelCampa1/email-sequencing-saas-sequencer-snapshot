import { contact_products, createDb, sequence_runs, sequences } from '@sequencer/db'
import { and, eq } from 'drizzle-orm'
import type { Env } from '../types'
import { findRunningRunForContact, isRunningRunUniqueConflict } from './active-run'
import { checkFirewall } from './firewall'
import { ensureListMembership } from './lists'
import { createLogger } from './observability'
import { checkSuppression } from './suppression'
import { assignVariant } from './variant'

export interface TransitionParams {
  contactId: string
  contactEmail: string
  productId: string
  productSlug: string
  productName?: string
  event: string
  properties?: Record<string, unknown>
  source?: string
}

export interface TransitionResult {
  startedRuns: string[]
}

/**
 * After existing runs have been notified/exited for an event, enroll the
 * contact into any active sequence whose enroll.trigger matches the event.
 *
 * Defensive: per-sequence failures are logged and skipped; never throws.
 */
export async function transitionOnEvent(
  env: Env,
  params: TransitionParams,
): Promise<TransitionResult> {
  const {
    contactId,
    contactEmail,
    productId,
    productSlug,
    productName,
    event,
    properties,
    source,
  } = params

  const logger = createLogger(env)
  const db = createDb(env.DB)
  const startedRuns: string[] = []

  // Find active sequences for this product
  let activeSeqs: Array<{
    slug: string
    product_id: string
    version: number
    definition: unknown
    goal: string | null
  }>
  try {
    activeSeqs = await db
      .select({
        slug: sequences.slug,
        product_id: sequences.product_id,
        version: sequences.version,
        definition: sequences.definition,
        goal: sequences.goal,
      })
      .from(sequences)
      .where(and(eq(sequences.product_id, productId), eq(sequences.is_active, true)))
      .limit(100)
  } catch (err) {
    logger.warn('sequence-transition: failed to query sequences', {
      error: (err as Error).message,
    })
    return { startedRuns }
  }

  for (const seq of activeSeqs) {
    const seqDef = seq.definition as Record<string, unknown> | null
    if (!seqDef) continue

    const enrollBlock = seqDef.enroll as Record<string, unknown> | undefined
    if (!enrollBlock) continue

    const trigger = enrollBlock.trigger
    if (typeof trigger !== 'string' || trigger !== event) continue

    // This sequence matches the event - attempt enrollment
    try {
      // Skip if a run is already active for this contact+product
      const existingRun = await findRunningRunForContact(db, contactId, productId)
      if (existingRun) {
        logger.info('sequence-transition: run already active, skipping', {
          contact: contactId,
          product: productId,
          sequence: seq.slug,
        })
        continue
      }

      // Suppression check
      const suppCheck = await checkSuppression(env, contactEmail, productId)
      if (suppCheck.suppressed) {
        logger.info('sequence-transition: contact suppressed, skipping', {
          contact: contactId,
          sequence: seq.slug,
        })
        continue
      }

      // Firewall check - NEVER bypass
      const firewallCheck = await checkFirewall(env, contactEmail, productId)
      if (firewallCheck.blocked) {
        logger.warn('sequence-transition: firewall blocked, skipping', {
          contact: contactId,
          product: productId,
          reason: firewallCheck.reason,
        })
        continue
      }

      // Check contact_product association is active
      const [assoc] = await db
        .select({ status: contact_products.status })
        .from(contact_products)
        .where(
          and(
            eq(contact_products.contact_id, contactId),
            eq(contact_products.product_id, productId),
          ),
        )
        .limit(1)

      if (!assoc || assoc.status !== 'active') {
        logger.info('sequence-transition: contact not active for product, skipping', {
          contact: contactId,
          product: productId,
        })
        continue
      }

      // Assign variant
      const variants = (seqDef.variants as Array<{ id: string; weight: number }> | undefined) ?? []
      const variantId = variants.length > 0 ? assignVariant(variants, contactEmail) : null

      // Ensure list membership (non-fatal)
      const goal = seq.goal ?? (seqDef.goal as string | undefined) ?? null
      try {
        const listSlug = `${seq.slug}`
        const listName = `${productName ?? productSlug}: ${goal ?? 'All'}`
        await ensureListMembership(db, {
          productId,
          listSlug,
          listName,
          contactId,
          source: 'transition',
        })
      } catch (listErr) {
        logger.warn('sequence-transition: list membership failed (non-fatal)', {
          error: (listErr as Error).message,
        })
      }

      // Insert sequence_runs row
      const runId = crypto.randomUUID()
      try {
        await db.insert(sequence_runs).values({
          id: runId,
          contact_id: contactId,
          product_id: productId,
          sequence_slug: seq.slug,
          sequence_version: seq.version,
          enrollment_source: source ?? 'transition',
          variant_assignment: variantId ? { variant_id: variantId } : null,
        })
      } catch (insertErr) {
        if (isRunningRunUniqueConflict(insertErr)) {
          logger.info('sequence-transition: unique conflict on insert, skipping', {
            contact: contactId,
            product: productId,
          })
          continue
        }
        throw insertErr
      }

      // Boot the Durable Object
      const doId = env.SEQUENCE_RUN.idFromName(runId)
      const doStub = env.SEQUENCE_RUN.get(doId)
      try {
        const startResp = await doStub.fetch(
          new Request('https://do/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId,
              contactId,
              contactEmail,
              productId,
              productSlug,
              sequenceSlug: seq.slug,
              sequenceVersion: seq.version,
              variantId,
            }),
          }),
        )
        if (!startResp.ok) {
          throw new Error(
            `SequenceRunDO start failed with ${startResp.status}: ${await startResp.text()}`,
          )
        }
      } catch (doErr) {
        // Mark run errored and skip
        await db
          .update(sequence_runs)
          .set({ status: 'errored', completed_at: new Date().toISOString() })
          .where(eq(sequence_runs.id, runId))
        logger.error('sequence-transition: DO start failed', {
          run_id: runId,
          error: (doErr as Error).message,
        })
        continue
      }

      logger.info('sequence-transition: enrolled contact', {
        run_id: runId,
        contact: contactId,
        sequence: seq.slug,
        trigger: event,
      })
      startedRuns.push(runId)
    } catch (err) {
      logger.warn('sequence-transition: unexpected error for sequence, skipping', {
        sequence: seq.slug,
        error: (err as Error).message,
      })
    }
  }

  return { startedRuns }
}
