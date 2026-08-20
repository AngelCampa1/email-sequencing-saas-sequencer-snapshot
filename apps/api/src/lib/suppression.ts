import { createDb, suppressions } from '@sequencer/db'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { Env } from '../types'
import { createLogger, trackMetric } from './observability'

export interface SuppressionCheckResult {
  suppressed: boolean
  reason?: string
  scope?: 'global' | 'product'
}

const KV_TTL_SECONDS = 3600 // 1 hour TTL for KV cache

export async function checkSuppression(
  env: Env,
  email: string,
  productId: string,
): Promise<SuppressionCheckResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const logger = createLogger(env, { product: productId })

  // 1. Check KV hot cache (global suppression)
  const globalKvKey = `supp:global:${normalizedEmail}`
  const productKvKey = `supp:product:${productId}:${normalizedEmail}`

  const [globalHit, productHit] = await Promise.all([
    env.SUPPRESSIONS.get(globalKvKey),
    env.SUPPRESSIONS.get(productKvKey),
  ])

  if (globalHit) {
    return { suppressed: true, reason: globalHit, scope: 'global' }
  }
  if (productHit) {
    return { suppressed: true, reason: productHit, scope: 'product' }
  }

  // 2. Fall through to D1
  const db = createDb(env.DB)
  const rows = await db
    .select()
    .from(suppressions)
    .where(
      and(
        eq(suppressions.email, normalizedEmail),
        or(
          eq(suppressions.scope, 'global'),
          and(eq(suppressions.scope, 'product'), eq(suppressions.product_id, productId)),
        ),
      ),
    )
    .limit(1)

  if (rows.length > 0) {
    const row = rows[0]
    // Populate KV cache
    const kvKey = row.scope === 'global' ? globalKvKey : productKvKey
    await env.SUPPRESSIONS.put(kvKey, row.reason ?? 'suppressed', {
      expirationTtl: KV_TTL_SECONDS,
    })
    return { suppressed: true, reason: row.reason ?? undefined, scope: row.scope }
  }

  logger.debug('No suppression found', { email: normalizedEmail })
  return { suppressed: false }
}

export async function addSuppression(
  env: Env,
  email: string,
  scope: 'global' | 'product',
  productId: string | null,
  reason: string,
  source: typeof suppressions.$inferInsert.source,
): Promise<{ created: boolean; id: string | null }> {
  const normalizedEmail = email.toLowerCase().trim()
  if (scope === 'product' && !productId) {
    throw new Error('productId is required for product-scoped suppressions')
  }
  const logger = createLogger(env, { product: productId ?? 'global' })
  const db = createDb(env.DB)

  const inserted = await db
    .insert(suppressions)
    .values({
      email: normalizedEmail,
      scope,
      product_id: productId,
      reason,
      source,
    })
    .onConflictDoNothing()
    .returning({ id: suppressions.id })

  const insertedId = inserted[0]?.id ?? null
  if (!insertedId) {
    const existing = await db
      .select({ id: suppressions.id, reason: suppressions.reason })
      .from(suppressions)
      .where(
        and(
          eq(suppressions.email, normalizedEmail),
          eq(suppressions.scope, scope),
          productId ? eq(suppressions.product_id, productId) : isNull(suppressions.product_id),
        ),
      )
      .limit(1)

    const existingRow = existing[0]
    const kvKey =
      scope === 'global'
        ? `supp:global:${normalizedEmail}`
        : `supp:product:${productId}:${normalizedEmail}`
    const effectiveReason = existingRow?.reason ?? 'suppressed'
    await env.SUPPRESSIONS.put(kvKey, effectiveReason, { expirationTtl: KV_TTL_SECONDS })
    await syncContactProductStatus(env, normalizedEmail, scope, productId, effectiveReason)

    logger.info('Suppression already exists', { email: normalizedEmail, scope, source })
    return { created: false, id: existingRow?.id ?? null }
  }

  // Invalidate / set KV cache immediately
  const kvKey =
    scope === 'global'
      ? `supp:global:${normalizedEmail}`
      : `supp:product:${productId}:${normalizedEmail}`
  await env.SUPPRESSIONS.put(kvKey, reason, { expirationTtl: KV_TTL_SECONDS })
  await syncContactProductStatus(env, normalizedEmail, scope, productId, reason)

  logger.info('Suppression added', { email: normalizedEmail, scope, source })

  trackMetric(env.ANALYTICS, {
    name: 'suppression.applied',
    dims: { scope, product: productId ?? 'global' },
  })

  return { created: true, id: insertedId }
}

async function syncContactProductStatus(
  env: Env,
  email: string,
  scope: 'global' | 'product',
  productId: string | null,
  reason: string,
): Promise<void> {
  const status = contactProductStatusForSuppression(reason)
  const now = new Date().toISOString()

  if (scope === 'product') {
    await env.DB.prepare(`
      UPDATE seq_contact_products
      SET status = ?,
          unsubscribed_at = CASE WHEN ? = 'unsubscribed' THEN ? ELSE unsubscribed_at END,
          unsubscribe_scope = ?,
          notes = ?,
          updated_at = ?
      WHERE product_id = ?
        AND contact_id IN (
          SELECT id FROM seq_contacts WHERE email = ?
        )
    `)
      .bind(status, status, now, scope, reason, now, productId, email)
      .run()
    return
  }

  await env.DB.prepare(`
    UPDATE seq_contact_products
    SET status = ?,
        unsubscribed_at = CASE WHEN ? = 'unsubscribed' THEN ? ELSE unsubscribed_at END,
        unsubscribe_scope = ?,
        notes = ?,
        updated_at = ?
    WHERE contact_id IN (
      SELECT id FROM seq_contacts WHERE email = ?
    )
  `)
    .bind(status, status, now, scope, reason, now, email)
    .run()
}

function contactProductStatusForSuppression(
  reason: string,
): 'unsubscribed' | 'bounced' | 'complained' {
  if (reason === 'hard_bounce') return 'bounced'
  if (reason === 'spam_complaint') return 'complained'
  return 'unsubscribed'
}

export async function removeSuppression(
  env: Env,
  email: string,
  scope: 'global' | 'product',
  productId: string | null,
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()
  const db = createDb(env.DB)

  await db
    .delete(suppressions)
    .where(
      and(
        eq(suppressions.email, normalizedEmail),
        eq(suppressions.scope, scope),
        productId ? eq(suppressions.product_id, productId) : isNull(suppressions.product_id),
      ),
    )

  // Invalidate KV
  const kvKey =
    scope === 'global'
      ? `supp:global:${normalizedEmail}`
      : `supp:product:${productId}:${normalizedEmail}`
  await env.SUPPRESSIONS.delete(kvKey)
}
