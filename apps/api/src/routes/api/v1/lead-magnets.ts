import {
  contact_products,
  contact_sources,
  contacts,
  createDb,
  events,
  lead_magnets,
  products,
  sequence_runs,
  sequences,
} from '@sequencer/db'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { findRunningRunForContact, isRunningRunUniqueConflict } from '../../../lib/active-run'
import { audit } from '../../../lib/audit'
import { createOrLoadContactByEmail } from '../../../lib/contact-upsert'
import { checkFirewall } from '../../../lib/firewall'
import {
  DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET,
  getLeadMagnetR2Bucket,
  isSupportedLeadMagnetR2Bucket,
} from '../../../lib/lead-magnet-assets'
import { createLogger } from '../../../lib/observability'
import { requireProductApiClientContext } from '../../../lib/product-api-auth'
import { checkSuppression } from '../../../lib/suppression'
import type { Env } from '../../../types'

export const leadMagnetsRoute = new Hono<{ Bindings: Env }>()
export const leadMagnetAssetsRoute = new Hono<{ Bindings: Env }>()

const ASSET_TOKEN_TTL_SECONDS = 15 * 60

type LeadMagnetDownloadBody = {
  email?: unknown
  first_name?: string
  last_name?: string
  source?: string
  utm?: Record<string, string>
}

// POST /api/v1/lead-magnets/:slug/download
// The migration wedge - products call this when a user downloads a lead magnet
leadMagnetsRoute.post('/:slug/download', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient

  const slug = c.req.param('slug')
  const callerProduct = apiClient.productSlug
  const actor = `api:${apiClient.clientId}`
  const logger = createLogger(c.env, { lead_magnet: slug })

  const rawBody = await c.req.json().catch(() => null)
  const parsedBody = parseLeadMagnetDownloadBody(rawBody)
  if (!parsedBody) return c.json({ error: 'invalid_lead_magnet_download_body' }, 400)
  const body = parsedBody

  const email = normalizeLeadMagnetEmail(body.email)
  if (!email) return c.json({ error: 'email must be a valid email address' }, 400)
  const requestFingerprint = leadMagnetDownloadRequestFingerprint(slug, email, body)
  const idempotencyKey = normalizeIdempotencyKey(c.req.header('Idempotency-Key'))
  const idempotencyCacheKey = idempotencyKey
    ? leadMagnetDownloadIdempotencyKey(apiClient.clientId, slug, idempotencyKey)
    : null
  if (idempotencyCacheKey) {
    const replay = await readLeadMagnetDownloadReplay(c.env, idempotencyCacheKey)
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        return c.json(
          {
            error: 'idempotency_key_conflict',
            detail:
              'Idempotency-Key was already used with a different lead magnet download request',
          },
          409,
        )
      }
      return c.json(replay.body, replay.status)
    }
  }
  const db = createDb(c.env.DB)

  // Load lead magnet
  const [lm] = await db
    .select()
    .from(lead_magnets)
    .where(and(eq(lead_magnets.slug, slug), eq(lead_magnets.active, true)))
    .limit(1)
  if (!lm) return c.json({ error: 'Lead magnet not found or inactive' }, 404)

  // Load product
  const [product] = await db.select().from(products).where(eq(products.id, lm.product_id)).limit(1)
  if (!product) return c.json({ error: 'Product not found' }, 404)

  if (callerProduct !== product.slug) {
    return c.json(
      { error: 'forbidden_product', detail: 'Token is not authorized for this product' },
      403,
    )
  }

  // Suppression check
  const suppCheck = await checkSuppression(c.env, email, product.id)
  if (suppCheck.suppressed) return c.json({ error: 'Suppressed', scope: suppCheck.scope }, 422)

  // Firewall check
  const firewallCheck = await checkFirewall(c.env, email, product.id)
  if (firewallCheck.blocked) return c.json({ error: 'firewall_block' }, 409)

  if (!lm.asset_r2_key) {
    return c.json(
      {
        error: 'asset_not_configured',
        detail: 'Lead magnet does not have a Sequencer-hosted asset',
      },
      422,
    )
  }
  const assetBucketName = lm.asset_r2_bucket ?? DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET
  if (
    !isSupportedLeadMagnetR2Bucket(assetBucketName) ||
    !getLeadMagnetR2Bucket(c.env, assetBucketName)
  ) {
    return c.json(
      {
        error: 'asset_bucket_not_configured',
        detail: 'Lead magnet asset bucket is not configured for this Worker',
      },
      422,
    )
  }

  // Upsert contact
  let [contact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1)
  if (!contact) {
    const id = crypto.randomUUID()
    ;({ contact } = await createOrLoadContactByEmail(db, {
      id,
      email,
      first_name: body.first_name ?? undefined,
      last_name: body.last_name ?? undefined,
    }))
  }

  // Ensure the download creates the same product membership used by the firewall.
  const existingAssociation = await db
    .select()
    .from(contact_products)
    .where(
      and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, product.id)),
    )
    .limit(1)

  if (existingAssociation.length === 0) {
    await db
      .insert(contact_products)
      .values({
        contact_id: contact.id,
        product_id: product.id,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
      })
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
  } else if (existingAssociation[0].status !== 'active') {
    return c.json({ error: 'Contact is not active for this product' }, 422)
  }

  // Record source attribution
  await db.insert(contact_sources).values({
    contact_id: contact.id,
    product_id: product.id,
    lead_magnet_id: lm.id,
    source: body.source,
    utm: body.utm,
  })

  // Enroll in fulfillment sequence if configured
  let runId: string | null = null
  let status: 'enrolled' | 'already_running' | 'no_sequence' | 'fulfillment_failed' = 'no_sequence'
  if (lm.fulfillment_sequence_slug) {
    const existingRun = await findRunningRunForContact(db, contact.id, product.id)
    if (existingRun) {
      runId = existingRun.id
      status = 'already_running'
    } else {
      const [seq] = await db
        .select()
        .from(sequences)
        .where(
          and(
            eq(sequences.slug, lm.fulfillment_sequence_slug),
            eq(sequences.product_id, product.id),
            eq(sequences.is_active, true),
          ),
        )
        .limit(1)
      if (!seq || seq.product_id !== product.id) {
        logger.error('Lead magnet fulfillment sequence is not available for product', {
          email,
          slug,
          sequence_slug: lm.fulfillment_sequence_slug,
          product: product.id,
        })
        status = 'fulfillment_failed'
      } else {
        runId = crypto.randomUUID()
        try {
          await db.insert(sequence_runs).values({
            id: runId,
            contact_id: contact.id,
            product_id: product.id,
            sequence_slug: lm.fulfillment_sequence_slug,
            sequence_version: seq.version,
            enrollment_source: `lead_magnet:${slug}`,
          })
          status = 'enrolled'
          // Boot DO
          const doId = c.env.SEQUENCE_RUN.idFromName(runId)
          const startResponse = await c.env.SEQUENCE_RUN.get(doId).fetch(
            new Request('https://do/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                runId,
                contactId: contact.id,
                contactEmail: email,
                productId: product.id,
                productSlug: product.slug,
                sequenceSlug: lm.fulfillment_sequence_slug,
                sequenceVersion: seq.version,
                variantId: null,
              }),
            }),
          )
          if (!startResponse.ok) {
            throw new Error(
              `SequenceRunDO start failed with ${startResponse.status}: ${await startResponse.text()}`,
            )
          }
        } catch (error) {
          if (isRunningRunUniqueConflict(error)) {
            const winningRun = await findRunningRunForContact(db, contact.id, product.id)
            if (winningRun) {
              runId = winningRun.id
              status = 'already_running'
            } else {
              throw error
            }
          } else {
            if (runId) {
              await db
                .update(sequence_runs)
                .set({ status: 'errored', completed_at: new Date().toISOString() })
                .where(eq(sequence_runs.id, runId))
            }
            logger.error('Lead magnet fulfillment DO start failed', {
              run_id: runId,
              email,
              slug,
              error: (error as Error).message,
            })
            status = 'fulfillment_failed'
          }
        }
      }
    }
  }

  // Return signed R2 URL for the configured asset.
  const token = crypto.randomUUID()
  const expiresAt = Date.now() + ASSET_TOKEN_TTL_SECONDS * 1000
  await c.env.SESSIONS.put(
    leadMagnetAssetTokenKey(token),
    JSON.stringify({
      slug,
      assetBucket: assetBucketName,
      assetKey: lm.asset_r2_key,
      expiresAt,
    }),
    { expirationTtl: ASSET_TOKEN_TTL_SECONDS },
  )
  const assetUrl = buildLeadMagnetAssetUrl(c.req.url, slug, token)

  let conversionDelivery: { notifiedRuns: number; failedRuns: string[] } | null = null
  if (lm.conversion_event_name) {
    conversionDelivery = await emitLeadMagnetConversionEvent(c, {
      db,
      contactId: contact.id,
      email,
      productId: product.id,
      productSlug: product.slug,
      leadMagnetId: lm.id,
      leadMagnetSlug: slug,
      eventName: lm.conversion_event_name,
      source: body.source,
      utm: body.utm,
      logger,
    })
  }

  await audit(c.env, actor, 'lead_magnet.downloaded', 'lead_magnet', lm.id, null, { email, slug })
  logger.info('Lead magnet downloaded', { email, slug, run_id: runId ?? undefined })

  if (status === 'fulfillment_failed') {
    return persistLeadMagnetDownloadResponse(
      c,
      idempotencyCacheKey,
      requestFingerprint,
      {
        ok: false,
        error: 'fulfillment_failed',
        detail: 'Lead magnet asset is available, but fulfillment sequence start failed',
        asset_url: assetUrl,
        run_id: runId,
        status,
      },
      207,
    )
  }

  if (conversionDelivery && conversionDelivery.failedRuns.length > 0) {
    return persistLeadMagnetDownloadResponse(
      c,
      idempotencyCacheKey,
      requestFingerprint,
      {
        ok: false,
        error: 'conversion_event_delivery_failed',
        detail: 'Lead magnet asset is available, but conversion event delivery failed',
        asset_url: assetUrl,
        run_id: runId,
        status,
        notified_runs: conversionDelivery.notifiedRuns,
        failed_runs: conversionDelivery.failedRuns,
      },
      207,
    )
  }

  return persistLeadMagnetDownloadResponse(
    c,
    idempotencyCacheKey,
    requestFingerprint,
    { ok: true, asset_url: assetUrl, run_id: runId, status },
    200,
  )
})

// GET /assets/lead-magnets/:slug?token=...
leadMagnetAssetsRoute.get('/:slug', serveLeadMagnetAsset)

// Backward-compatible Worker route. Production Access must bypass this tokenized asset path too.
leadMagnetsRoute.get('/:slug/asset', serveLeadMagnetAsset)

async function serveLeadMagnetAsset(c: Context<{ Bindings: Env }>) {
  const slug = c.req.param('slug')
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'token is required' }, 400)

  const tokenKey = leadMagnetAssetTokenKey(token)
  const rawToken = await c.env.SESSIONS.get(tokenKey)
  if (!rawToken) return c.json({ error: 'asset token not found or expired' }, 410)

  let parsed: unknown
  try {
    parsed = JSON.parse(rawToken)
  } catch {
    await c.env.SESSIONS.delete(tokenKey)
    return c.json({ error: 'asset token invalid' }, 410)
  }
  if (!isAssetTokenRecord(parsed)) {
    await c.env.SESSIONS.delete(tokenKey)
    return c.json({ error: 'asset token invalid' }, 410)
  }

  if (parsed.expiresAt < Date.now()) {
    await c.env.SESSIONS.delete(tokenKey)
    return c.json({ error: 'asset token expired' }, 410)
  }
  if (parsed.slug !== slug) return c.json({ error: 'asset token does not match lead magnet' }, 403)
  if (!parsed.assetKey) return c.json({ error: 'asset token invalid' }, 410)

  const bucketName = parsed.assetBucket ?? DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET
  const bucket = getLeadMagnetR2Bucket(c.env, bucketName)
  if (!bucket) return c.json({ error: 'asset bucket not configured' }, 500)

  const object = await bucket.get(parsed.assetKey)
  if (!object) return c.json({ error: 'asset not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata?.(headers)
  if (!headers.has('content-type') && object.httpMetadata?.contentType) {
    headers.set('content-type', object.httpMetadata.contentType)
  }
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'private, max-age=0, no-store')
  return new Response(object.body, { headers })
}

function leadMagnetAssetTokenKey(token: string): string {
  return `lead_magnet_asset:${token}`
}

function leadMagnetDownloadIdempotencyKey(
  clientId: string,
  slug: string,
  idempotencyKey: string,
): string {
  return `lead_magnet_download:${clientId}:${slug}:${idempotencyKey}`
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 200)
}

async function readLeadMagnetDownloadReplay(
  env: Env,
  key: string,
): Promise<{
  status: 200 | 207
  body: LeadMagnetDownloadReplayBody
  requestFingerprint: string
} | null> {
  const raw = await env.SESSIONS.get(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isLeadMagnetDownloadReplay(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

async function persistLeadMagnetDownloadResponse(
  c: Context<{ Bindings: Env }>,
  idempotencyCacheKey: string | null,
  requestFingerprint: string,
  body: LeadMagnetDownloadReplayBody,
  status: 200 | 207,
): Promise<Response> {
  if (idempotencyCacheKey && status === 200) {
    await c.env.SESSIONS.put(
      idempotencyCacheKey,
      JSON.stringify({ status, body, requestFingerprint }),
      { expirationTtl: ASSET_TOKEN_TTL_SECONDS },
    )
  }
  return c.json(body, status)
}

type LeadMagnetDownloadReplayBody = {
  ok: boolean
  asset_url: string
  run_id?: string | null
  status?: string
  error?: string
  detail?: string
  notified_runs?: number
  failed_runs?: string[]
}

function isLeadMagnetDownloadReplay(
  value: unknown,
): value is { status: 200 | 207; body: LeadMagnetDownloadReplayBody; requestFingerprint: string } {
  if (!isPlainRecord(value)) return false
  if (value.status !== 200 && value.status !== 207) return false
  if (!isPlainRecord(value.body)) return false
  return (
    typeof value.body.ok === 'boolean' &&
    typeof value.body.asset_url === 'string' &&
    typeof value.requestFingerprint === 'string'
  )
}

function leadMagnetDownloadRequestFingerprint(
  slug: string,
  email: string,
  body: LeadMagnetDownloadBody,
): string {
  return JSON.stringify({
    slug,
    email,
    first_name: body.first_name ?? null,
    last_name: body.last_name ?? null,
    source: body.source ?? null,
    utm: sortRecord(body.utm ?? {}),
  })
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

function buildLeadMagnetAssetUrl(requestUrl: string, slug: string, token: string): string {
  const url = new URL(requestUrl)
  url.pathname = `/assets/lead-magnets/${encodeURIComponent(slug)}`
  url.search = ''
  url.searchParams.set('token', token)
  return url.toString()
}

async function emitLeadMagnetConversionEvent(
  c: Context<{ Bindings: Env }>,
  input: {
    db: ReturnType<typeof createDb>
    contactId: string
    email: string
    productId: string
    productSlug: string
    leadMagnetId: string
    leadMagnetSlug: string
    eventName: string
    source?: string
    utm?: Record<string, string>
    logger: ReturnType<typeof createLogger>
  },
): Promise<{ notifiedRuns: number; failedRuns: string[] }> {
  const properties = {
    lead_magnet_id: input.leadMagnetId,
    lead_magnet_slug: input.leadMagnetSlug,
    source: input.source,
    utm: input.utm ?? {},
  }
  await input.db.insert(events).values({
    provider: 'internal',
    provider_event_id: null,
    message_id: null,
    type: input.eventName,
    payload: {
      email: input.email,
      product: input.productSlug,
      ...properties,
    },
    side_effects_started_at: null,
    side_effects_completed_at: null,
  })

  const activeRuns = await input.db
    .select()
    .from(sequence_runs)
    .where(
      and(
        eq(sequence_runs.contact_id, input.contactId),
        eq(sequence_runs.product_id, input.productId),
        eq(sequence_runs.status, 'running'),
      ),
    )
    .limit(50)

  let notifiedRuns = 0
  const failedRuns: string[] = []
  for (const run of activeRuns) {
    try {
      const doId = c.env.SEQUENCE_RUN.idFromName(run.id)
      const response = await c.env.SEQUENCE_RUN.get(doId).fetch(
        new Request('https://do/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: input.eventName, properties }),
        }),
      )
      if (!response.ok) {
        failedRuns.push(run.id)
        input.logger.warn('Failed to notify DO of lead magnet conversion event', {
          run_id: run.id,
          status: response.status,
          body: await response.text().catch(() => ''),
        })
        continue
      }
      notifiedRuns += 1
    } catch (error) {
      failedRuns.push(run.id)
      input.logger.warn('Failed to notify DO of lead magnet conversion event', {
        run_id: run.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { notifiedRuns, failedRuns }
}

function isAssetTokenRecord(value: unknown): value is {
  slug: string
  assetBucket?: string
  assetKey: string
  expiresAt: number
} {
  if (!isPlainRecord(value)) return false
  if (typeof value.slug !== 'string') return false
  if (typeof value.assetKey !== 'string' || value.assetKey.length === 0) return false
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return false
  if (value.assetBucket !== undefined && typeof value.assetBucket !== 'string') return false
  return true
}

function parseLeadMagnetDownloadBody(rawBody: unknown): LeadMagnetDownloadBody | null {
  if (!isPlainRecord(rawBody)) return {}

  const firstName = readOptionalString(rawBody, 'first_name')
  const lastName = readOptionalString(rawBody, 'last_name')
  const source = readOptionalString(rawBody, 'source')
  const utm = readOptionalUtm(rawBody.utm)
  if (firstName === null || lastName === null || source === null || utm === null) return null

  return {
    email: rawBody.email,
    first_name: firstName,
    last_name: lastName,
    source,
    utm,
  }
}

function readOptionalString(data: Record<string, unknown>, key: string): string | undefined | null {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  return value
}

function readOptionalUtm(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined) return undefined
  if (!isPlainRecord(value)) return null

  const utm: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null
    utm[key] = entry
  }
  return utm
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeLeadMagnetEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}
