import { contacts, createDb, products, sequence_runs } from '@sequencer/db'
import { ProductUnsubscribeRequestSchema } from '@sequencer/shared'
import { and, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { audit } from '../../../lib/audit'
import { createLogger } from '../../../lib/observability'
import { requireProductApiClientContext } from '../../../lib/product-api-auth'
import { addSuppression } from '../../../lib/suppression'
import {
  normalizeUnsubscribeEmail,
  normalizeUnsubscribeProduct,
  verifyUnsubscribeSignature,
} from '../../../lib/unsubscribe-token'
import type { Env } from '../../../types'

export const unsubscribeRoute = new Hono<{ Bindings: Env }>()

unsubscribeRoute.post('/', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient

  const callerProduct = apiClient.productSlug
  const actor = `api:${apiClient.clientId}`
  const logger = createLogger(c.env)
  const body = await c.req.json().catch(() => null)
  if (isPlainObject(body)) {
    if (body.scope !== undefined && body.scope !== 'product') {
      return c.json({ error: 'global_unsubscribe_forbidden' }, 400)
    }
    if (body.product === undefined) {
      return c.json({ error: 'product_required' }, 400)
    }
  }
  const parsed = ProductUnsubscribeRequestSchema.safeParse(body)
  if (!parsed.success)
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)

  const { email, product, scope, reason } = parsed.data
  const normalizedEmail = email.toLowerCase()
  const suppressionReason = reason?.trim() || 'unsubscribed'
  const db = createDb(c.env.DB)

  if (callerProduct !== product) {
    return c.json(
      { error: 'forbidden_product', detail: 'Token is not authorized for this product' },
      403,
    )
  }

  let productId: string | null = null
  const [prod] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, product))
    .limit(1)
  productId = prod?.id ?? null
  if (!productId) {
    return c.json({ error: 'unknown_product' }, 400)
  }

  await addSuppression(c.env, normalizedEmail, scope, productId, suppressionReason, 'manual')
  const delivery = await notifyActiveProductRunsOfUnsubscribe(c.env, db, normalizedEmail, productId)
  await audit(c.env, actor, 'contact.unsubscribed', 'suppression', null, null, {
    email: normalizedEmail,
    scope,
    product,
  })
  logger.info('Unsubscribe processed', {
    email: normalizedEmail,
    scope,
    product,
    notified_runs: delivery.notifiedRuns,
    failed_runs: delivery.failedRuns.length,
  })

  if (delivery.failedRuns.length > 0) {
    return c.json(
      {
        ok: false,
        error: 'unsubscribe_delivery_failed',
        email: normalizedEmail,
        scope,
        notified_runs: delivery.notifiedRuns,
        failed_runs: delivery.failedRuns,
      },
      207,
    )
  }

  return c.json(
    { ok: true, email: normalizedEmail, scope, notified_runs: delivery.notifiedRuns },
    200,
  )
})

// GET /api/v1/unsubscribe or /unsubscribe - one-click unsubscribe link handler (from email footer)
type UnsubscribeContext = Context<{ Bindings: Env }>

export async function oneClickUnsubscribe(c: UnsubscribeContext) {
  const rawEmail = c.req.query('email')
  const rawProduct = c.req.query('product')

  if (!rawEmail) return c.text('Missing email parameter', 400)
  if (!rawProduct) return c.text('Missing product parameter', 400)

  const normalizedEmail = normalizeUnsubscribeEmail(rawEmail)
  if (!normalizedEmail) return c.text('Invalid email parameter', 400)
  const product = normalizeUnsubscribeProduct(rawProduct)
  if (!product) return c.text('Missing product parameter', 400)
  const signatureValid = await verifyUnsubscribeSignature({
    email: normalizedEmail,
    product,
    signature: c.req.query('sig'),
    secret: c.env.UNSUBSCRIBE_SIGNING_SECRET,
  })
  if (!signatureValid) return c.text('Invalid unsubscribe link', 403)

  const db = createDb(c.env.DB)
  const [prod] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, product))
    .limit(1)
  const productId = prod?.id ?? null
  if (!productId) return c.text('Unknown product', 400)

  await addSuppression(
    c.env,
    normalizedEmail,
    'product',
    productId,
    'one_click_unsubscribe',
    'webhook',
  )
  const delivery = await notifyActiveProductRunsOfUnsubscribe(c.env, db, normalizedEmail, productId)
  if (delivery.failedRuns.length > 0) {
    createLogger(c.env).warn('One-click unsubscribe processed with DO delivery failures', {
      email: normalizedEmail,
      product,
      notified_runs: delivery.notifiedRuns,
      failed_runs: delivery.failedRuns.join(','),
    })
  }

  // Return a simple HTML confirmation page (product name HTML-escaped to avoid reflective XSS)
  const safeProduct = product ? ` from ${escapeHtml(product)}` : ''
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Unsubscribed</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
.card{background:#fff;border-radius:8px;padding:32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px}</style>
</head>
<body><div class="card"><h2 style="color:#111;margin:0 0 8px">You've been unsubscribed</h2>
<p style="color:#6b7280;margin:0">You won't receive any more emails${safeProduct}. This takes effect immediately.</p></div></body></html>`)
}

unsubscribeRoute.get('/', oneClickUnsubscribe)

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function notifyActiveProductRunsOfUnsubscribe(
  env: Env,
  db: ReturnType<typeof createDb>,
  email: string,
  productId: string,
): Promise<{ notifiedRuns: number; failedRuns: string[] }> {
  const logger = createLogger(env)
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, email))
    .limit(1)
  if (!contact) return { notifiedRuns: 0, failedRuns: [] }

  const activeRuns = await db
    .select({ id: sequence_runs.id })
    .from(sequence_runs)
    .where(
      and(
        eq(sequence_runs.contact_id, contact.id),
        eq(sequence_runs.product_id, productId),
        eq(sequence_runs.status, 'running'),
      ),
    )

  let notifiedRuns = 0
  const failedRuns: string[] = []
  for (const run of activeRuns) {
    try {
      const doId = env.SEQUENCE_RUN.idFromName(run.id)
      const stub = env.SEQUENCE_RUN.get(doId)
      const response = await stub.fetch(
        new Request('https://do/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'unsubscribed' }),
        }),
      )
      if (!response.ok) {
        failedRuns.push(run.id)
        logger.warn('Failed to notify DO of unsubscribe', {
          run_id: run.id,
          status: response.status,
          body: await response.text().catch(() => ''),
        })
        continue
      }
      notifiedRuns += 1
    } catch (error) {
      failedRuns.push(run.id)
      logger.warn('Failed to notify DO of unsubscribe', {
        run_id: run.id,
        error: (error as Error).message,
      })
    }
  }

  return { notifiedRuns, failedRuns }
}
