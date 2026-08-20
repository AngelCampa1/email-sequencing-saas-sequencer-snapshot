import {
  audit_log,
  createDb,
  domain_health,
  instantly_campaigns,
  products,
  sequences,
  suppressions,
} from '@sequencer/db'
import type { TemplateProps } from '@sequencer/emails'
import { and, desc, eq, gte, lte, ne, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { DashboardAccessForbiddenError, requireDashboardAccessJwt } from '../../lib/access'
import { audit } from '../../lib/audit'
import { buildEmailTemplateProps } from '../../lib/email-branding'
import {
  DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET,
  getLeadMagnetR2Bucket,
  isSupportedLeadMagnetR2Bucket,
} from '../../lib/lead-magnet-assets'
import { cancelActiveRunsForSuppression } from '../../lib/run-control'
import { isRenderableTemplate } from '../../lib/template-renderer'
import type { Env } from '../../types'

const internalRoute = new Hono<{ Bindings: Env; Variables: { accessEmail: string } }>()

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

type SequenceDefinitionRow = {
  sequence_slug: string
  version: number
  is_active: number | boolean
  definition: unknown
  product_id: string
  product_slug: string
  product_name: string
  brand_color?: string | null
}

type TemplateCatalogSequence = {
  slug: string
  version: number
  is_active: boolean
  step_ids: string[]
  subjects: string[]
}

type TemplateCatalogRow = {
  slug: string
  product_id: string
  product_slug: string
  product_name: string
  kind: 'react-email' | 'legacy-camaudit'
  renderable: boolean
  preview_url: string
  usage_count: number
  sequences: TemplateCatalogSequence[]
  source: { legacy_key?: string }
}

type EnrichedContactRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  properties: unknown
  created_at: string
  updated_at: string
  memberships_json: string | null
  active_run_json: string | null
  active_runs_json: string | null
}

type ContactMembership = {
  product_id: string
  product_slug: string
  product_name: string
  status: 'active' | 'unsubscribed' | 'bounced' | 'complained'
  created_at: string
  updated_at: string
}

type ContactActiveRun = {
  id: string
  product_id?: string
  product_slug?: string
  product_name?: string
  sequence_slug: string
  sequence_version: number
  status: 'running'
  current_step_index: number
  started_at: string
  enrollment_source: string
}

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

type ApiTokenRow = {
  id: string
  product_id: string
  product_slug: string
  product_name: string
  label: string
  access_service_token_id: string
  created_at: string
  revoked_at: string | null
}

type ApiTokenProductRow = {
  id: string
  slug: string
  name: string
}

type InternalProductRow = {
  id: string
  slug: string
  name: string
  brand_color: string
  default_from_email: string
  default_reply_to: string | null
  resend_api_key_secret_name: string
  suppression_scope: 'global' | 'product'
  firewall_partner_id: string | null
  created_at: string
  updated_at: string
}

type InternalSequenceRow = {
  slug: string
  product_id: string
  version: number
  definition: unknown
  goal: string | null
  exit_conditions: unknown
  is_active: number | boolean
  compiled_at: string
  compiled_from_sha: string | null
}

type InternalLeadMagnetRow = {
  id: string
  product_id: string
  product_slug: string
  product_name: string
  slug: string
  name: string
  asset_r2_bucket: string | null
  asset_r2_key: string | null
  fulfillment_sequence_slug: string | null
  conversion_event_name: string | null
  active: number | boolean
  created_at: string
}

type LeadMagnetAssetStatus =
  | 'available'
  | 'missing'
  | 'bucket_unbound'
  | 'not_configured'
  | 'unknown'

const LEAD_MAGNET_ASSET_PROBE_CONCURRENCY = 8

internalRoute.use('*', async (c, next) => {
  const token = c.req.header('Cf-Access-Jwt-Assertion')
  if (!token) {
    // Dev-only bypass: wrangler dev --local has no real CF Access JWT in front of it.
    // Production sets ENVIRONMENT="production"; this branch is unreachable there.
    if (c.env.ENVIRONMENT === 'development') {
      c.set('accessEmail', 'operator@example.com')
      await next()
      return
    }
    return c.json({ error: 'Not authenticated' }, 401)
  }

  let email: string
  try {
    email = (await requireDashboardAccessJwt(token, c.env)).email
  } catch (error) {
    if (error instanceof DashboardAccessForbiddenError) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const status = error instanceof Error && error.message.includes('not configured') ? 503 : 401
    return c.json({ error: 'Not authenticated' }, status)
  }

  c.set('accessEmail', email)
  await next()
})

// GET /api/internal/products
internalRoute.get('/products', async (c) => {
  const db = createDb(c.env.DB)
  const rows = await db.select().from(products)
  return c.json(rows)
})

// POST /api/internal/products
internalRoute.post('/products', async (c) => {
  const actor = c.get('accessEmail')
  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const parsed = parseProductCreate(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const id = productIdFromSlug(parsed.value.slug)
  if (parsed.value.firewall_partner_id) {
    const firewallPartner = await selectInternalProduct(c.env.DB, parsed.value.firewall_partner_id)
    if (!firewallPartner) {
      return c.json({ error: 'firewall_partner_id must reference an existing product' }, 400)
    }
  }

  try {
    await c.env.DB.prepare(`
      INSERT INTO seq_products (
        id,
        slug,
        name,
        brand_color,
        default_from_email,
        default_reply_to,
        resend_api_key_secret_name,
        suppression_scope,
        firewall_partner_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        id,
        parsed.value.slug,
        parsed.value.name,
        parsed.value.brand_color,
        parsed.value.default_from_email,
        parsed.value.default_reply_to,
        parsed.value.resend_api_key_secret_name,
        parsed.value.suppression_scope,
        parsed.value.firewall_partner_id,
      )
      .run()
  } catch (error) {
    if (isUniqueConstraintError(error)) return c.json({ error: 'Product already exists' }, 409)
    throw error
  }

  const created = await selectInternalProduct(c.env.DB, id)
  if (!created) return c.json({ error: 'Product not found after create' }, 500)

  await audit(c.env, actor, 'product.created', 'product', id, null, created)
  return c.json(created, 201)
})

// PATCH /api/internal/products/:id
internalRoute.patch('/products/:id', async (c) => {
  const actor = c.get('accessEmail')
  const id = c.req.param('id')
  if (!id) return c.json({ error: 'Invalid product id' }, 400)

  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const existing = await selectInternalProduct(c.env.DB, id)
  if (!existing) return c.json({ error: 'Product not found' }, 404)

  const parsed = parseProductPatch(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const next: InternalProductRow = {
    ...existing,
    ...parsed.value,
  }
  if (next.firewall_partner_id) {
    const firewallPartner = await selectInternalProduct(c.env.DB, next.firewall_partner_id)
    if (!firewallPartner) {
      return c.json({ error: 'firewall_partner_id must reference an existing product' }, 400)
    }
  }

  try {
    const update = await c.env.DB.prepare(`
      UPDATE seq_products
      SET slug = ?,
          name = ?,
          brand_color = ?,
          default_from_email = ?,
          default_reply_to = ?,
          resend_api_key_secret_name = ?,
          suppression_scope = ?,
          firewall_partner_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
      .bind(
        next.slug,
        next.name,
        next.brand_color,
        next.default_from_email,
        next.default_reply_to,
        next.resend_api_key_secret_name,
        next.suppression_scope,
        next.firewall_partner_id,
        id,
      )
      .run()
    if (d1ChangedRows(update) === 0) return c.json({ error: 'Product not found' }, 404)
  } catch (error) {
    if (isUniqueConstraintError(error)) return c.json({ error: 'Product slug already exists' }, 409)
    throw error
  }

  const updated = await selectInternalProduct(c.env.DB, id)
  if (!updated) return c.json({ error: 'Product not found' }, 404)

  await audit(c.env, actor, 'product.updated', 'product', id, existing, updated)
  return c.json(updated)
})

// DELETE /api/internal/products/:id
internalRoute.delete('/products/:id', async (c) => {
  const actor = c.get('accessEmail')
  const id = c.req.param('id')
  if (!id) return c.json({ error: 'Invalid product id' }, 400)

  const existing = await selectInternalProduct(c.env.DB, id)
  if (!existing) return c.json({ error: 'Product not found' }, 404)

  const dependencyRow = await c.env.DB.prepare(`
    SELECT
      (
        (SELECT COUNT(*) FROM seq_sequences WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_contact_products WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_contact_sources WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_suppressions WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_lead_magnets WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_api_tokens WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_messages WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_sequence_runs WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_instantly_campaigns WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_lists WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_templates WHERE product_id = ?) +
        (SELECT COUNT(*) FROM seq_products WHERE firewall_partner_id = ?)
      ) AS count
  `)
    .bind(id, id, id, id, id, id, id, id, id, id, id, id)
    .first<{ count: number }>()
  if ((dependencyRow?.count ?? 0) > 0) {
    return c.json({ error: 'Product has related data and cannot be deleted' }, 409)
  }

  const deleted = await c.env.DB.prepare('DELETE FROM seq_products WHERE id = ?').bind(id).run()
  if (d1ChangedRows(deleted) === 0) return c.json({ error: 'Product not found' }, 404)

  await audit(c.env, actor, 'product.deleted', 'product', id, existing, null)
  return c.json({ ok: true })
})

// GET /api/internal/sequences
internalRoute.get('/sequences', async (c) => {
  const db = createDb(c.env.DB)
  const productSlug = c.req.query('product')
  if (productSlug) {
    // join via products table to filter by slug
    const productRow = await db
      .select()
      .from(products)
      .where(eq(products.slug, productSlug))
      .limit(1)
    if (productRow.length === 0) return c.json([])
    const rows = await db.select().from(sequences).where(eq(sequences.product_id, productRow[0].id))
    return c.json(rows)
  }
  const rows = await db.select().from(sequences)
  return c.json(rows)
})

// POST /api/internal/sequences
internalRoute.post('/sequences', async (c) => {
  const actor = c.get('accessEmail')
  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const parsed = parseSequenceCreate(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const product = await selectInternalProduct(c.env.DB, parsed.value.product_id)
  if (!product) return c.json({ error: 'product_id must reference an existing product' }, 400)

  try {
    await c.env.DB.prepare(`
      INSERT INTO seq_sequences (
        slug,
        product_id,
        version,
        definition,
        goal,
        exit_conditions,
        is_active,
        compiled_from_sha
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        parsed.value.slug,
        parsed.value.product_id,
        parsed.value.version,
        JSON.stringify(parsed.value.definition),
        parsed.value.goal,
        JSON.stringify(parsed.value.exit_conditions),
        parsed.value.is_active ? 1 : 0,
        'dashboard',
      )
      .run()
  } catch (error) {
    if (isUniqueConstraintError(error)) return c.json({ error: 'Sequence already exists' }, 409)
    throw error
  }

  const created = await selectInternalSequence(c.env.DB, parsed.value.slug)
  if (!created) return c.json({ error: 'Sequence not found after create' }, 500)

  const createdFormatted = formatSequenceAuditState(created)
  await audit(
    c.env,
    actor,
    'sequence.created',
    'sequence',
    parsed.value.slug,
    null,
    createdFormatted,
  )
  return c.json(createdFormatted, 201)
})

// PATCH /api/internal/sequences/:slug
internalRoute.patch('/sequences/:slug', async (c) => {
  const actor = c.get('accessEmail')
  const slug = c.req.param('slug')?.trim()
  if (!slug) return c.json({ error: 'Invalid slug' }, 400)

  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const patch = parseSequencePatch(body)
  if (!patch.ok) return c.json({ error: patch.error }, 400)

  const existing = await selectInternalSequence(c.env.DB, slug)
  if (!existing) return c.json({ error: 'Sequence not found' }, 404)

  const existingFormatted = formatSequenceAuditState(existing)
  const next = {
    definition:
      patch.value.definition !== undefined ? patch.value.definition : existingFormatted.definition,
    goal: patch.value.goal !== undefined ? patch.value.goal : existingFormatted.goal,
    is_active:
      patch.value.is_active !== undefined ? patch.value.is_active : existingFormatted.is_active,
  }

  const update = await c.env.DB.prepare(`
    UPDATE seq_sequences
    SET definition = ?,
        goal = ?,
        is_active = ?
    WHERE slug = ?
  `)
    .bind(JSON.stringify(next.definition), next.goal, next.is_active ? 1 : 0, slug)
    .run()
  if (d1ChangedRows(update) === 0) return c.json({ error: 'Sequence not found' }, 404)

  const updated = await selectInternalSequence(c.env.DB, slug)
  if (!updated) return c.json({ error: 'Sequence not found' }, 404)

  const updatedFormatted = formatSequenceAuditState(updated)
  await audit(
    c.env,
    actor,
    'sequence.updated',
    'sequence',
    slug,
    existingFormatted,
    updatedFormatted,
  )
  return c.json(updatedFormatted)
})

// DELETE /api/internal/sequences/:slug
internalRoute.delete('/sequences/:slug', async (c) => {
  const actor = c.get('accessEmail')
  const slug = c.req.param('slug')?.trim()
  if (!slug) return c.json({ error: 'Invalid slug' }, 400)

  const existing = await selectInternalSequence(c.env.DB, slug)
  if (!existing) return c.json({ error: 'Sequence not found' }, 404)

  const runRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM seq_sequence_runs WHERE sequence_slug = ?',
  )
    .bind(slug)
    .first<{ count: number }>()
  if ((runRow?.count ?? 0) > 0) {
    return c.json({ error: 'Sequence has runs and cannot be deleted' }, 409)
  }

  const deleted = await c.env.DB.prepare('DELETE FROM seq_sequences WHERE slug = ?')
    .bind(slug)
    .run()
  if (d1ChangedRows(deleted) === 0) return c.json({ error: 'Sequence not found' }, 404)

  await audit(
    c.env,
    actor,
    'sequence.deleted',
    'sequence',
    slug,
    formatSequenceAuditState(existing),
    null,
  )
  return c.json({ ok: true })
})

// GET /api/internal/contacts
internalRoute.get('/contacts', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10)
  const q = c.req.query('q')
  const productSlug = c.req.query('product')
  const activeSequence = c.req.query('active_sequence')?.trim()
  const rawSort = c.req.query('sort')
  const rawDir = c.req.query('dir')
  const requestedLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 100)
  const requestedOffset = Math.min(Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0), 1000)
  const searchPattern = q ? `%${escapeLikePattern(q)}%` : null

  const sortColumnMap: Record<string, string> = {
    email: 'c.email',
    name: 'c.first_name',
    created_at: 'c.created_at',
  }
  const dirMap: Record<string, string> = { asc: 'ASC', desc: 'DESC' }
  const sortKey = rawSort && Object.hasOwn(sortColumnMap, rawSort) ? rawSort : 'created_at'
  const dirKey = rawDir && Object.hasOwn(dirMap, rawDir) ? rawDir : 'desc'
  const sortDir = dirMap[dirKey]

  let orderByClause: string
  if (sortKey === 'name') {
    orderByClause = `ORDER BY c.first_name ${sortDir}, c.last_name ${sortDir}, c.id ASC`
  } else {
    orderByClause = `ORDER BY ${sortColumnMap[sortKey]} ${sortDir}, c.id ASC`
  }

  const activeSequenceClause =
    activeSequence === 'none'
      ? `AND NOT EXISTS (
        SELECT 1 FROM seq_sequence_runs ar_filter
        WHERE ar_filter.contact_id = c.id
          AND ar_filter.status = 'running'
      )`
      : activeSequence
        ? `AND EXISTS (
        SELECT 1 FROM seq_sequence_runs ar_filter
        WHERE ar_filter.contact_id = c.id
          AND ar_filter.status = 'running'
          ${activeSequence === 'any' ? '' : 'AND ar_filter.sequence_slug = ?'}
      )`
        : ''
  const binds: unknown[] = [
    searchPattern,
    searchPattern,
    searchPattern,
    searchPattern,
    productSlug ?? null,
    productSlug ?? null,
  ]
  if (activeSequence && activeSequence !== 'any' && activeSequence !== 'none') {
    binds.push(activeSequence)
  }
  binds.push(requestedLimit, requestedOffset)

  const rows = await c.env.DB.prepare(`
    /* internal contacts enriched list */
    SELECT
      c.id,
      c.email,
      c.first_name,
      c.last_name,
      c.properties,
      c.created_at,
      c.updated_at,
      COALESCE((
        SELECT json_group_array(json_object(
          'product_id', membership.product_id,
          'product_slug', membership.product_slug,
          'product_name', membership.product_name,
          'status', membership.status,
          'created_at', membership.created_at,
          'updated_at', membership.updated_at
        ))
        FROM (
          SELECT
            cp.product_id,
            p.slug AS product_slug,
            p.name AS product_name,
            cp.status,
            cp.created_at,
            cp.updated_at
          FROM seq_contact_products cp
          JOIN seq_products p ON p.id = cp.product_id
          WHERE cp.contact_id = c.id
          ORDER BY p.slug ASC
        ) membership
      ), '[]') AS memberships_json,
      (
        SELECT json_object(
          'id', r.id,
          'sequence_slug', r.sequence_slug,
          'sequence_version', r.sequence_version,
          'status', r.status,
          'current_step_index', r.current_step_index,
          'started_at', r.started_at,
          'enrollment_source', r.enrollment_source
        )
        FROM seq_sequence_runs r
        WHERE r.contact_id = c.id
          AND r.status = 'running'
        ORDER BY r.started_at DESC
        LIMIT 1
      ) AS active_run_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', active_run.id,
          'product_id', active_run.product_id,
          'product_slug', active_run.product_slug,
          'product_name', active_run.product_name,
          'sequence_slug', active_run.sequence_slug,
          'sequence_version', active_run.sequence_version,
          'status', active_run.status,
          'current_step_index', active_run.current_step_index,
          'started_at', active_run.started_at,
          'enrollment_source', active_run.enrollment_source
        ))
        FROM (
          SELECT
            r.id,
            r.product_id,
            p.slug AS product_slug,
            p.name AS product_name,
            r.sequence_slug,
            r.sequence_version,
            r.status,
            r.current_step_index,
            r.started_at,
            r.enrollment_source
          FROM seq_sequence_runs r
          JOIN seq_products p ON p.id = r.product_id
          WHERE r.contact_id = c.id
            AND r.status = 'running'
          ORDER BY r.started_at DESC
        ) active_run
      ), '[]') AS active_runs_json
    FROM seq_contacts c
    WHERE (? IS NULL OR (c.email LIKE ? ESCAPE '\\' OR c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\'))
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM seq_contact_products cp2
        JOIN seq_products p2 ON p2.id = cp2.product_id
        WHERE cp2.contact_id = c.id AND p2.slug = ?
      ))
      ${activeSequenceClause}
    ${orderByClause}
    LIMIT ?
    OFFSET ?
  `)
    .bind(...binds)
    .all<EnrichedContactRow>()

  return c.json((rows.results ?? []).map(formatContactRow))
})

// POST /api/internal/contacts
internalRoute.post('/contacts', async (c) => {
  const actor = c.get('accessEmail')
  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const parsed = parseContactCreate(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const input = parsed.value

  if (input.product_id) {
    const product = await c.env.DB.prepare(`
      SELECT id, slug, name
      FROM seq_products
      WHERE id = ?
      LIMIT 1
    `)
      .bind(input.product_id)
      .first<ApiTokenProductRow>()
    if (!product) return c.json({ error: 'Product not found' }, 404)
  }

  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(`
      INSERT INTO seq_contacts (id, email, first_name, last_name, properties)
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(id, input.email, input.first_name, input.last_name, null)
      .run()

    if (input.product_id) {
      await c.env.DB.prepare(`
        INSERT INTO seq_contact_products (
          id,
          contact_id,
          product_id,
          first_name,
          last_name,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
        .bind(
          crypto.randomUUID(),
          id,
          input.product_id,
          input.first_name,
          input.last_name,
          'active',
        )
        .run()
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Contact email is already in use' }, 409)
    }
    console.error(error)
    return c.json({ error: 'Internal error', code: 'internal_error' }, 500)
  }

  const created = await selectEnrichedContact(c.env.DB, id)
  const formatted =
    created ??
    ({
      id,
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
      properties: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      memberships: [],
      active_run: null,
      active_runs: [],
    } satisfies ReturnType<typeof formatContactRow>)

  await audit(c.env, actor, 'contact.created', 'contact', id, null, formatted)
  return c.json(formatted, 201)
})

// PATCH /api/internal/contacts/:id
internalRoute.patch('/contacts/:id', async (c) => {
  const actor = c.get('accessEmail')
  const contactId = c.req.param('id')
  if (!isUuidLike(contactId)) return c.json({ error: 'Invalid contact id' }, 400)
  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const existing = await c.env.DB.prepare(`
    SELECT id, email, first_name, last_name, properties, created_at, updated_at
    FROM seq_contacts
    WHERE id = ?
    LIMIT 1
  `)
    .bind(contactId)
    .first<Record<string, unknown>>()
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  const parsed = parseContactPatch(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const patch = parsed.value
  const nextEmail = patch.email ?? String(existing.email)
  const nextFirstName =
    patch.first_name !== undefined ? patch.first_name : nullableDbString(existing.first_name)
  const nextLastName =
    patch.last_name !== undefined ? patch.last_name : nullableDbString(existing.last_name)
  const nextProperties =
    patch.properties !== undefined ? patch.properties : (existing.properties ?? null)

  try {
    const update = await c.env.DB.prepare(`
      UPDATE seq_contacts
      SET email = ?,
          first_name = ?,
          last_name = ?,
          properties = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
      .bind(nextEmail, nextFirstName, nextLastName, nextProperties, contactId)
      .run()
    if (d1ChangedRows(update) === 0) return c.json({ error: 'Contact not found' }, 404)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Contact email is already in use' }, 409)
    }
    console.error(error)
    return c.json({ error: 'Internal error', code: 'internal_error' }, 500)
  }

  const updated = await selectEnrichedContact(c.env.DB, contactId)
  const formatted =
    updated ??
    ({
      id: contactId,
      email: nextEmail,
      first_name: nextFirstName,
      last_name: nextLastName,
      properties: parseJsonRecord(nextProperties),
      created_at: String(existing.created_at),
      updated_at: new Date().toISOString(),
      memberships: [],
      active_run: null,
      active_runs: [],
    } satisfies ReturnType<typeof formatContactRow>)

  await audit(c.env, actor, 'contact.updated', 'contact', contactId, existing, formatted)
  return c.json(formatted)
})

// DELETE /api/internal/contacts/:id
internalRoute.delete('/contacts/:id', async (c) => {
  const contactId = c.req.param('id')
  if (!isUuidLike(contactId)) return c.json({ error: 'Invalid contact id' }, 400)

  const contact = await c.env.DB.prepare(`
    SELECT id, email, first_name, last_name, properties, created_at, updated_at
    FROM seq_contacts
    WHERE id = ?
    LIMIT 1
  `)
    .bind(contactId)
    .first<Record<string, unknown>>()
  if (!contact) return c.json({ error: 'Contact not found' }, 404)

  await c.env.DB.prepare(`
    DELETE FROM seq_events
    WHERE message_id IN (
      SELECT resend_message_id
      FROM seq_messages
      WHERE contact_id = ?
        AND resend_message_id IS NOT NULL
    )
  `)
    .bind(contactId)
    .run()
  await c.env.DB.prepare(`
    DELETE FROM seq_events
    WHERE provider = 'internal'
      AND json_extract(payload, '$.email') = ?
  `)
    .bind(String(contact.email))
    .run()
  await c.env.DB.prepare('DELETE FROM seq_messages WHERE contact_id = ?').bind(contactId).run()
  await c.env.DB.prepare(`
    DELETE FROM seq_steps
    WHERE run_id IN (
      SELECT id FROM seq_sequence_runs WHERE contact_id = ?
    )
  `)
    .bind(contactId)
    .run()
  await c.env.DB.prepare('DELETE FROM seq_sequence_runs WHERE contact_id = ?').bind(contactId).run()
  await c.env.DB.prepare('DELETE FROM seq_list_members WHERE contact_id = ?').bind(contactId).run()
  await c.env.DB.prepare('DELETE FROM seq_contact_products WHERE contact_id = ?')
    .bind(contactId)
    .run()
  await c.env.DB.prepare('DELETE FROM seq_contact_sources WHERE contact_id = ?')
    .bind(contactId)
    .run()
  await c.env.DB.prepare('DELETE FROM seq_contacts WHERE id = ?').bind(contactId).run()

  await audit(c.env, c.get('accessEmail'), 'contact.deleted', 'contact', contactId, contact, null)

  return c.json({ ok: true })
})

// GET /api/internal/contacts/:id
internalRoute.get('/contacts/:id', async (c) => {
  const contactId = c.req.param('id')
  if (!isUuidLike(contactId)) return c.json({ error: 'Invalid id' }, 400)
  const rows = await queryRows<EnrichedContactRow>(
    c.env.DB,
    `
    /* internal contact detail */
    SELECT
      c.id,
      c.email,
      c.first_name,
      c.last_name,
      c.properties,
      c.created_at,
      c.updated_at,
      COALESCE((
        SELECT json_group_array(json_object(
          'product_id', membership.product_id,
          'product_slug', membership.product_slug,
          'product_name', membership.product_name,
          'status', membership.status,
          'created_at', membership.created_at,
          'updated_at', membership.updated_at
        ))
        FROM (
          SELECT
            cp.product_id,
            p.slug AS product_slug,
            p.name AS product_name,
            cp.status,
            cp.created_at,
            cp.updated_at
          FROM seq_contact_products cp
          JOIN seq_products p ON p.id = cp.product_id
          WHERE cp.contact_id = c.id
          ORDER BY p.slug ASC
        ) membership
      ), '[]') AS memberships_json,
      (
        SELECT json_object(
          'id', r.id,
          'sequence_slug', r.sequence_slug,
          'sequence_version', r.sequence_version,
          'status', r.status,
          'current_step_index', r.current_step_index,
          'started_at', r.started_at,
          'enrollment_source', r.enrollment_source
        )
        FROM seq_sequence_runs r
        WHERE r.contact_id = c.id
          AND r.status = 'running'
        ORDER BY r.started_at DESC
        LIMIT 1
      ) AS active_run_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', active_run.id,
          'product_id', active_run.product_id,
          'product_slug', active_run.product_slug,
          'product_name', active_run.product_name,
          'sequence_slug', active_run.sequence_slug,
          'sequence_version', active_run.sequence_version,
          'status', active_run.status,
          'current_step_index', active_run.current_step_index,
          'started_at', active_run.started_at,
          'enrollment_source', active_run.enrollment_source
        ))
        FROM (
          SELECT
            r.id,
            r.product_id,
            p.slug AS product_slug,
            p.name AS product_name,
            r.sequence_slug,
            r.sequence_version,
            r.status,
            r.current_step_index,
            r.started_at,
            r.enrollment_source
          FROM seq_sequence_runs r
          JOIN seq_products p ON p.id = r.product_id
          WHERE r.contact_id = c.id
            AND r.status = 'running'
          ORDER BY r.started_at DESC
        ) active_run
      ), '[]') AS active_runs_json
    FROM seq_contacts c
    WHERE c.id = ?
    LIMIT 1
  `,
    contactId,
  )
  const row = rows[0]
  if (!row) return c.json({ error: 'Contact not found' }, 404)

  const contact = formatContactRow(row)
  const contactRuns = (
    await queryRows<Record<string, unknown>>(
      c.env.DB,
      `
    SELECT *
    FROM seq_sequence_runs
    WHERE contact_id = ?
    ORDER BY started_at DESC
    LIMIT 100
  `,
      contact.id,
    )
  ).map(normalizeRunRow)
  const runIds = new Set(contactRuns.map((run) => String(run.id)))
  const scopedSteps =
    runIds.size === 0
      ? []
      : await queryRows<Record<string, unknown>>(
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
  const contactMessages = await queryRows<Record<string, unknown>>(
    c.env.DB,
    `
    SELECT *
    FROM seq_messages
    WHERE contact_id = ?
    ORDER BY sent_at DESC
    LIMIT 500
  `,
    contact.id,
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
          await queryRows<Record<string, unknown>>(
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
    await queryRows<Record<string, unknown>>(
      c.env.DB,
      `
    SELECT *
    FROM seq_events
    WHERE provider = 'internal'
      AND json_extract(payload, '$.email') = ?
    ORDER BY received_at ASC
    LIMIT 500
  `,
      contact.email,
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
  const events = [...providerEvents, ...internalEvents]

  return c.json({
    ...contact,
    runs: contactRuns.map((run) => ({
      ...run,
      steps: scopedSteps
        .filter((step) => step.run_id === run.id)
        .map((step) => {
          const message = messagesByStepId.get(step.id) ?? null
          return {
            ...step,
            message,
            events:
              typeof message?.resend_message_id === 'string'
                ? (eventsByMessageId.get(message.resend_message_id) ?? [])
                : [],
          }
        }),
    })),
    messages: contactMessages,
    events,
    timeline: buildContactTimeline(contactRuns, scopedSteps, contactMessages, events),
  })
})

// GET /api/internal/suppressions
internalRoute.get('/suppressions', async (c) => {
  const db = createDb(c.env.DB)
  const scope = c.req.query('scope')
  if (scope !== undefined && scope !== 'global' && scope !== 'product') {
    return c.json({ error: 'scope must be global or product' }, 400)
  }
  const rawLimit = parseInt(c.req.query('limit') ?? '100', 10)
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10)
  const requestedLimit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500)
  const requestedOffset = Math.min(Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0), 1000)
  const q = c.req.query('q')

  // Build the where predicate by combining scope and email-LIKE filters as needed.
  const scopePredicate = scope ? eq(suppressions.scope, scope) : undefined
  const emailPattern = q ? `%${escapeLikePattern(q)}%` : null
  const emailPredicate = q ? sql`${suppressions.email} like ${emailPattern} escape '\\'` : undefined
  const wherePredicate =
    scopePredicate && emailPredicate
      ? and(scopePredicate, emailPredicate)
      : (scopePredicate ?? emailPredicate)

  const rows = await db
    .select()
    .from(suppressions)
    .where(wherePredicate)
    .orderBy(desc(suppressions.created_at))
    .limit(requestedLimit)
    .offset(requestedOffset)
  return c.json(rows)
})

// POST /api/internal/suppressions - dashboard manual add
internalRoute.post('/suppressions', async (c) => {
  const { addSuppression } = await import('../../lib/suppression')
  const actor = c.get('accessEmail')
  const rawBody = await c.req.json().catch(() => null)
  const body = rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {}
  const email = normalizeDashboardEmail(body.email)
  if (!email) {
    return c.json({ error: 'email must be a valid email address' }, 400)
  }
  const scope = body.scope === 'global' || body.scope === 'product' ? body.scope : null
  if (!scope) {
    return c.json({ error: 'scope must be global or product' }, 400)
  }
  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : ''
  if (scope === 'product' && !productId) {
    return c.json({ error: 'product_id is required for product-scoped suppressions' }, 400)
  }
  if (scope === 'product') {
    const db = createDb(c.env.DB)
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1)
    if (!product) {
      return c.json({ error: 'product not found' }, 404)
    }
  }
  const reason =
    typeof body.reason === 'string' && body.reason.trim() !== ''
      ? body.reason.trim()
      : `manual:${actor}`
  const result = await addSuppression(
    c.env,
    email,
    scope,
    scope === 'product' ? productId : null,
    reason,
    'manual',
  )
  await audit(
    c.env,
    actor,
    result.created ? 'suppression.created' : 'suppression.requested',
    'suppression',
    result.id,
    null,
    {
      email,
      scope,
      product_id: scope === 'product' ? productId : null,
      reason,
      source: 'manual',
    },
  )
  await cancelActiveRunsForSuppression(c.env, {
    email,
    productId: scope === 'product' ? productId : null,
    reason,
  })
  return c.json({ ok: true }, 201)
})

// DELETE /api/internal/suppressions/:id
internalRoute.delete('/suppressions/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!isUuidLike(id)) {
      return c.json({ error: 'Invalid suppression id' }, 400)
    }
    const db = createDb(c.env.DB)
    const [row] = await db.select().from(suppressions).where(eq(suppressions.id, id)).limit(1)
    if (!row) {
      return c.json({ error: 'Suppression not found' }, 404)
    }
    // Use shared helper so the KV hot cache is invalidated alongside the D1 row.
    // Otherwise checkSuppression() would keep returning suppressed=true until KV TTL elapses.
    const { removeSuppression } = await import('../../lib/suppression')
    await removeSuppression(
      c.env,
      row.email,
      row.scope as 'global' | 'product',
      row.product_id ?? null,
    )
    const actor = c.get('accessEmail')
    await audit(c.env, actor, 'suppression.removed', 'suppression', id, row, null)
    return c.json({ ok: true })
  } catch (err) {
    console.error('DELETE /suppressions/:id error', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// GET /api/internal/overview
internalRoute.get('/overview', async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString()
  const sevenDaysAgoDate = sevenDaysAgo.slice(0, 10)

  let activeRuns: { count: number } | null
  let sendVol7d: { count: number } | null
  let sendVol30d: { count: number } | null
  let suppressions7d: { count: number } | null
  let bounced7d: { count: number } | null
  let topSeqRows: D1Result<{ slug: string; product: string; enrollments: number }>
  let rotRows: D1Result<{ slug: string }>
  let campaignCount: { count: number } | null
  let coldStats: { sent: number; replied: number } | null

  try {
    ;[
      activeRuns,
      sendVol7d,
      sendVol30d,
      suppressions7d,
      bounced7d,
      topSeqRows,
      rotRows,
      campaignCount,
      coldStats,
    ] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) AS count FROM seq_sequence_runs WHERE status = ?')
        .bind('running')
        .first<{ count: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) AS count FROM seq_messages WHERE sent_at >= ?')
        .bind(sevenDaysAgo)
        .first<{ count: number }>(),
      c.env.DB.prepare(`
        /* overview: send_volume_30d */
        SELECT COUNT(*) AS count FROM seq_messages WHERE sent_at >= ?
      `)
        .bind(thirtyDaysAgo)
        .first<{ count: number }>(),
      c.env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM seq_suppressions
        WHERE created_at >= ?
          AND (
            reason IN ('unsubscribed', 'one_click_unsubscribe')
            OR lower(reason) LIKE '%unsubscribe%'
          )
      `)
        .bind(sevenDaysAgo)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM seq_messages WHERE sent_at >= ? AND bounced_at IS NOT NULL',
      )
        .bind(sevenDaysAgo)
        .first<{ count: number }>(),
      c.env.DB.prepare(`
        SELECT
          s.slug AS slug,
          p.slug AS product,
          COUNT(r.id) AS enrollments
        FROM seq_sequences s
        JOIN seq_products p ON p.id = s.product_id
        LEFT JOIN seq_sequence_runs r
          ON r.product_id = s.product_id
          AND r.sequence_slug = s.slug
        WHERE s.is_active = 1
        GROUP BY s.slug, p.slug
        ORDER BY enrollments DESC, s.slug ASC
        LIMIT 10
      `).all<{ slug: string; product: string; enrollments: number }>(),
      c.env.DB.prepare(`
        SELECT s.slug AS slug
        FROM seq_sequences s
        LEFT JOIN seq_sequence_runs r
          ON r.product_id = s.product_id
          AND r.sequence_slug = s.slug
          AND r.started_at >= ?
        WHERE s.is_active = 1
        GROUP BY s.slug
        HAVING COUNT(r.id) = 0
        ORDER BY s.slug ASC
        LIMIT 10
      `)
        .bind(ninetyDaysAgo)
        .all<{ slug: string }>(),
      c.env.DB.prepare('SELECT COUNT(*) AS count FROM seq_instantly_campaigns').first<{
        count: number
      }>(),
      c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(sent), 0) AS sent,
          COALESCE(SUM(replied), 0) AS replied
        FROM seq_instantly_campaign_daily_stats
        WHERE date >= ?
      `)
        .bind(sevenDaysAgoDate)
        .first<{ sent: number; replied: number }>(),
    ])
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Overview unavailable' }, 503)
  }

  const send7 = Number(sendVol7d?.count ?? 0)
  const coldSent = Number(coldStats?.sent ?? 0)

  return c.json({
    send_volume_7d: send7,
    send_volume_30d: Number(sendVol30d?.count ?? 0),
    active_runs: Number(activeRuns?.count ?? 0),
    unsub_rate_7d: send7 > 0 ? Number(suppressions7d?.count ?? 0) / send7 : 0,
    rot_sequences: (rotRows.results ?? []).map((r) => r.slug),
    top_sequences: (topSeqRows.results ?? []).map((s) => ({
      slug: s.slug,
      product: s.product,
      enrollments: Number(s.enrollments),
    })),
    warm_summary: {
      total_sent_7d: send7,
      avg_bounce_rate: send7 > 0 ? Number(bounced7d?.count ?? 0) / send7 : 0,
    },
    cold_summary: {
      total_campaigns: Number(campaignCount?.count ?? 0),
      total_sent_7d: coldSent,
      reply_rate: coldSent > 0 ? Number(coldStats?.replied ?? 0) / coldSent : 0,
    },
  })
})

// GET /api/internal/audit
internalRoute.get('/audit', async (c) => {
  const db = createDb(c.env.DB)
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const currentPage = Number.isFinite(page) && page > 0 ? page : 1
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize

  // Optional filters: actor (exact match), action (exact match), from/to (ISO date range).
  const actor = c.req.query('actor')
  const action = c.req.query('action')
  const from = c.req.query('from')
  // Make bare date `to` values inclusive of the whole day by appending end-of-day time.
  const rawTo = c.req.query('to')
  const to = rawTo ? (rawTo.includes('T') ? rawTo : `${rawTo}T23:59:59.999Z`) : undefined

  // Collect each active predicate then combine with and().
  const predicates = [
    actor ? eq(audit_log.actor, actor) : undefined,
    action ? eq(audit_log.action, action) : undefined,
    from ? gte(audit_log.at, from) : undefined,
    to ? lte(audit_log.at, to) : undefined,
  ].filter((p): p is NonNullable<typeof p> => p !== undefined)
  const wherePredicate = predicates.length > 0 ? and(...predicates) : undefined

  const rows = await db
    .select()
    .from(audit_log)
    .where(wherePredicate)
    .orderBy(desc(audit_log.at))
    .limit(pageSize + 1)
    .offset(offset)
  return c.json({
    entries: rows.slice(0, pageSize),
    has_next: rows.length > pageSize,
  })
})

// GET /api/internal/deliverability
internalRoute.get('/deliverability', async (c) => {
  const db = createDb(c.env.DB)
  const domainRows = await db
    .select()
    .from(domain_health)
    .orderBy(desc(domain_health.date))
    .limit(50)
  const campaignRows = await db
    .select()
    .from(instantly_campaigns)
    .where(ne(instantly_campaigns.status, 'retired'))
    .limit(20)
  return c.json({ domains: domainRows, instantly_campaigns: campaignRows })
})

// PATCH /api/internal/deliverability/instantly-campaigns/:id
internalRoute.patch('/deliverability/instantly-campaigns/:id', async (c) => {
  const actor = c.get('accessEmail')
  const campaignId = c.req.param('id').trim()
  if (!isUuidLike(campaignId)) return c.json({ error: 'Invalid id' }, 400)

  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)
  if (!Object.hasOwn(body, 'product_id')) {
    return c.json({ error: 'product_id is required' }, 400)
  }
  const productId = nullableTrimmedString(body.product_id)
  if (productId === undefined) {
    return c.json({ error: 'product_id must be a string or null' }, 400)
  }

  const existing = await c.env.DB.prepare(`
    /* internal instantly campaign lookup */
    SELECT id, product_id, name, status, created_at_instantly, synced_at
    FROM seq_instantly_campaigns
    WHERE id = ?
    LIMIT 1
  `)
    .bind(campaignId)
    .first<Record<string, unknown>>()
  if (!existing) return c.json({ error: 'Instantly campaign not found' }, 404)

  if (productId) {
    const product = await c.env.DB.prepare(`
      /* internal instantly campaign product lookup */
      SELECT id, slug, name
      FROM seq_products
      WHERE id = ?
      LIMIT 1
    `)
      .bind(productId)
      .first<ApiTokenProductRow>()
    if (!product) return c.json({ error: 'Product not found' }, 404)
  }

  const update = await c.env.DB.prepare(`
    UPDATE seq_instantly_campaigns
    SET product_id = ?
    WHERE id = ?
  `)
    .bind(productId, campaignId)
    .run()
  if (d1ChangedRows(update) === 0) return c.json({ error: 'Instantly campaign not found' }, 404)

  const updated = await c.env.DB.prepare(`
    /* internal instantly campaign updated row */
    SELECT id, product_id, name, status, created_at_instantly, synced_at
    FROM seq_instantly_campaigns
    WHERE id = ?
    LIMIT 1
  `)
    .bind(campaignId)
    .first<Record<string, unknown>>()
  const row = updated ?? { ...existing, product_id: productId }

  await audit(
    c.env,
    actor,
    'instantly_campaign.updated',
    'instantly_campaign',
    campaignId,
    existing,
    row,
  )
  return c.json(row)
})

// GET /api/internal/templates
internalRoute.get('/templates', async (c) => {
  const productFilter = c.req.query('product')
  const kindFilter = c.req.query('kind')
  const rows = await c.env.DB.prepare(`
    SELECT
      s.slug AS sequence_slug,
      s.version AS version,
      s.is_active AS is_active,
      s.definition AS definition,
      p.id AS product_id,
      p.slug AS product_slug,
      p.name AS product_name
    FROM seq_sequences s
    JOIN seq_products p ON p.id = s.product_id
    WHERE s.is_active = 1
      AND (? IS NULL OR p.slug = ?)
    ORDER BY p.slug ASC, s.slug ASC
  `)
    .bind(productFilter ?? null, productFilter ?? null)
    .all<SequenceDefinitionRow>()

  const catalog = new Map<string, TemplateCatalogRow>()
  for (const row of rows.results ?? []) {
    if (!row.is_active) continue
    const definition = parseSequenceDefinition(row.definition)
    if (!definition?.steps) continue

    for (const candidate of definition.steps) {
      const step = parseTemplateCatalogStep(candidate)
      if (!step) continue
      const kind = getTemplateKind(step.template)
      if (kindFilter && kind !== kindFilter) continue

      const key = `${row.product_id}:${step.template}`
      let entry = catalog.get(key)
      if (!entry) {
        const renderable = await isRenderableTemplate(step.template)
        entry = {
          slug: step.template,
          product_id: row.product_id,
          product_slug: row.product_slug,
          product_name: row.product_name,
          kind,
          renderable,
          preview_url: renderable
            ? buildTemplatePreviewUrl(step.template, row.product_slug, row.sequence_slug)
            : '',
          usage_count: 0,
          sequences: [],
          source:
            kind === 'legacy-camaudit'
              ? { legacy_key: step.template.slice('legacy/camaudit/'.length) }
              : {},
        }
        catalog.set(key, entry)
      }

      entry.usage_count += 1
      let sequenceUsage = entry.sequences.find((sequence) => sequence.slug === row.sequence_slug)
      if (!sequenceUsage) {
        sequenceUsage = {
          slug: row.sequence_slug,
          version: Number(row.version),
          is_active: Boolean(row.is_active),
          step_ids: [],
          subjects: [],
        }
        entry.sequences.push(sequenceUsage)
      }
      sequenceUsage.step_ids.push(step.id)
      for (const subject of extractSubjects(step.subject)) {
        if (!sequenceUsage.subjects.includes(subject)) {
          sequenceUsage.subjects.push(subject)
        }
      }
    }
  }

  return c.json(
    [...catalog.values()].sort(
      (a, b) => a.product_slug.localeCompare(b.product_slug) || a.slug.localeCompare(b.slug),
    ),
  )
})

// GET /api/internal/lead-magnets
internalRoute.get('/lead-magnets', async (c) => {
  const rows = await c.env.DB.prepare(`
    /* internal lead magnets list */
    SELECT
      l.id,
      l.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      l.slug,
      l.name,
      l.asset_r2_bucket,
      l.asset_r2_key,
      l.fulfillment_sequence_slug,
      l.conversion_event_name,
      l.active,
      l.created_at
    FROM seq_lead_magnets l
    JOIN seq_products p ON p.id = l.product_id
    ORDER BY p.slug ASC, l.slug ASC
  `).all<InternalLeadMagnetRow>()

  const enriched = await mapWithConcurrency(
    rows.results ?? [],
    LEAD_MAGNET_ASSET_PROBE_CONCURRENCY,
    (row) => formatLeadMagnetRow(c.env, row),
  )
  return c.json(enriched)
})

// POST /api/internal/lead-magnets
internalRoute.post('/lead-magnets', async (c) => {
  const actor = c.get('accessEmail')
  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const parsed = parseLeadMagnetCreate(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const input = parsed.value
  if (input.asset_r2_bucket && !isSupportedLeadMagnetR2Bucket(input.asset_r2_bucket)) {
    return c.json({ error: 'asset_r2_bucket is not supported' }, 400)
  }

  const product = await c.env.DB.prepare(`
    /* internal lead magnet product lookup */
    SELECT id, slug, name
    FROM seq_products
    WHERE id = ?
    LIMIT 1
  `)
    .bind(input.product_id)
    .first<ApiTokenProductRow>()
  if (!product) return c.json({ error: 'Product not found' }, 404)

  if (input.fulfillment_sequence_slug) {
    const sequence = await c.env.DB.prepare(`
      /* internal lead magnet fulfillment sequence lookup */
      SELECT slug
      FROM seq_sequences
      WHERE slug = ? AND product_id = ? AND is_active = 1
      LIMIT 1
    `)
      .bind(input.fulfillment_sequence_slug, product.id)
      .first<{ slug: string }>()
    if (!sequence) {
      return c.json({ error: 'Fulfillment sequence not found for lead magnet product' }, 400)
    }
  }

  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(`
      INSERT INTO seq_lead_magnets (
        id,
        product_id,
        slug,
        name,
        asset_r2_bucket,
        asset_r2_key,
        fulfillment_sequence_slug,
        conversion_event_name,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        id,
        product.id,
        input.slug,
        input.name,
        input.asset_r2_bucket,
        input.asset_r2_key,
        input.fulfillment_sequence_slug,
        input.conversion_event_name,
        input.active ? 1 : 0,
      )
      .run()
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Lead magnet slug is already in use' }, 409)
    }
    console.error(error)
    return c.json({ error: 'Internal error', code: 'internal_error' }, 500)
  }

  const created = await c.env.DB.prepare(`
    /* internal lead magnet created row */
    SELECT
      l.id,
      l.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      l.slug,
      l.name,
      l.asset_r2_bucket,
      l.asset_r2_key,
      l.fulfillment_sequence_slug,
      l.conversion_event_name,
      l.active,
      l.created_at
    FROM seq_lead_magnets l
    JOIN seq_products p ON p.id = l.product_id
    WHERE l.id = ?
    LIMIT 1
  `)
    .bind(id)
    .first<InternalLeadMagnetRow>()
  const formatted = await formatLeadMagnetRow(
    c.env,
    created ?? {
      id,
      product_id: product.id,
      product_slug: product.slug,
      product_name: product.name,
      slug: input.slug,
      name: input.name,
      asset_r2_bucket: input.asset_r2_bucket,
      asset_r2_key: input.asset_r2_key,
      fulfillment_sequence_slug: input.fulfillment_sequence_slug,
      conversion_event_name: input.conversion_event_name,
      active: input.active,
      created_at: new Date().toISOString(),
    },
  )

  await audit(
    c.env,
    actor,
    'lead_magnet.created',
    'lead_magnet',
    id,
    null,
    formatLeadMagnetAuditState(formatted),
  )
  return c.json(formatted, 201)
})

// PATCH /api/internal/lead-magnets/:id
internalRoute.patch('/lead-magnets/:id', async (c) => {
  const actor = c.get('accessEmail')
  const id = c.req.param('id')
  if (!isUuidLike(id)) return c.json({ error: 'Invalid id' }, 400)
  const body = await c.req.json().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'Invalid request' }, 400)

  const existing = await c.env.DB.prepare(`
    /* internal lead magnet lookup */
    SELECT
      l.id,
      l.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      l.slug,
      l.name,
      l.asset_r2_bucket,
      l.asset_r2_key,
      l.fulfillment_sequence_slug,
      l.conversion_event_name,
      l.active,
      l.created_at
    FROM seq_lead_magnets l
    JOIN seq_products p ON p.id = l.product_id
    WHERE l.id = ?
    LIMIT 1
  `)
    .bind(id)
    .first<InternalLeadMagnetRow>()
  if (!existing) return c.json({ error: 'Lead magnet not found' }, 404)

  const patch = parseLeadMagnetPatch(body)
  if (!patch.ok) return c.json({ error: patch.error }, 400)

  const next = {
    asset_r2_bucket:
      patch.value.asset_r2_bucket !== undefined
        ? patch.value.asset_r2_bucket
        : existing.asset_r2_bucket,
    asset_r2_key:
      patch.value.asset_r2_key !== undefined ? patch.value.asset_r2_key : existing.asset_r2_key,
    fulfillment_sequence_slug:
      patch.value.fulfillment_sequence_slug !== undefined
        ? patch.value.fulfillment_sequence_slug
        : existing.fulfillment_sequence_slug,
    conversion_event_name:
      patch.value.conversion_event_name !== undefined
        ? patch.value.conversion_event_name
        : existing.conversion_event_name,
    active: patch.value.active !== undefined ? patch.value.active : Boolean(existing.active),
  }
  if (next.asset_r2_bucket && !isSupportedLeadMagnetR2Bucket(next.asset_r2_bucket)) {
    return c.json({ error: 'asset_r2_bucket is not supported' }, 400)
  }

  if (next.fulfillment_sequence_slug) {
    const sequence = await c.env.DB.prepare(`
      /* internal lead magnet fulfillment sequence lookup */
      SELECT slug
      FROM seq_sequences
      WHERE slug = ? AND product_id = ? AND is_active = 1
      LIMIT 1
    `)
      .bind(next.fulfillment_sequence_slug, existing.product_id)
      .first<{ slug: string }>()
    if (!sequence) {
      return c.json({ error: 'Fulfillment sequence not found for lead magnet product' }, 400)
    }
  }

  const update = await c.env.DB.prepare(`
    UPDATE seq_lead_magnets
    SET asset_r2_bucket = ?,
        asset_r2_key = ?,
        fulfillment_sequence_slug = ?,
        conversion_event_name = ?,
        active = ?
    WHERE id = ?
  `)
    .bind(
      next.asset_r2_bucket,
      next.asset_r2_key,
      next.fulfillment_sequence_slug,
      next.conversion_event_name,
      next.active ? 1 : 0,
      id,
    )
    .run()
  if (d1ChangedRows(update) === 0) return c.json({ error: 'Lead magnet not found' }, 404)

  const updated = await c.env.DB.prepare(`
    /* internal lead magnet updated row */
    SELECT
      l.id,
      l.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      l.slug,
      l.name,
      l.asset_r2_bucket,
      l.asset_r2_key,
      l.fulfillment_sequence_slug,
      l.conversion_event_name,
      l.active,
      l.created_at
    FROM seq_lead_magnets l
    JOIN seq_products p ON p.id = l.product_id
    WHERE l.id = ?
    LIMIT 1
  `)
    .bind(id)
    .first<InternalLeadMagnetRow>()
  const formatted = await formatLeadMagnetRow(
    c.env,
    updated ?? { ...existing, ...next, active: next.active ? 1 : 0 },
  )

  await audit(
    c.env,
    actor,
    'lead_magnet.updated',
    'lead_magnet',
    id,
    formatLeadMagnetAuditState(existing),
    formatLeadMagnetAuditState(formatted),
  )
  return c.json(formatted)
})

// DELETE /api/internal/lead-magnets/:id
internalRoute.delete('/lead-magnets/:id', async (c) => {
  const actor = c.get('accessEmail')
  const id = c.req.param('id')
  if (!isUuidLike(id)) return c.json({ error: 'Invalid id' }, 400)

  const existing = await c.env.DB.prepare(`
    /* internal lead magnet delete lookup */
    SELECT
      l.id,
      l.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      l.slug,
      l.name,
      l.asset_r2_bucket,
      l.asset_r2_key,
      l.fulfillment_sequence_slug,
      l.conversion_event_name,
      l.active,
      l.created_at
    FROM seq_lead_magnets l
    JOIN seq_products p ON p.id = l.product_id
    WHERE l.id = ?
    LIMIT 1
  `)
    .bind(id)
    .first<InternalLeadMagnetRow>()
  if (!existing) return c.json({ error: 'Lead magnet not found' }, 404)

  const dependency = await c.env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM seq_contact_sources
    WHERE lead_magnet_id = ?
  `)
    .bind(id)
    .first<{ count: number }>()
  if (Number(dependency?.count ?? 0) > 0) {
    return c.json({ error: 'Lead magnet has captured contacts and cannot be deleted' }, 409)
  }

  const deleted = await c.env.DB.prepare('DELETE FROM seq_lead_magnets WHERE id = ?').bind(id).run()
  if (d1ChangedRows(deleted) === 0) return c.json({ error: 'Lead magnet not found' }, 404)

  await audit(
    c.env,
    actor,
    'lead_magnet.deleted',
    'lead_magnet',
    id,
    formatLeadMagnetAuditState(existing),
    null,
  )
  return c.json({ ok: true })
})

// GET /api/internal/api-tokens
internalRoute.get('/api-tokens', async (c) => {
  const rows = await c.env.DB.prepare(`
    /* internal api tokens list */
    SELECT
      t.id,
      t.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      t.label,
      t.access_service_token_id,
      t.created_at,
      t.revoked_at
    FROM seq_api_tokens t
    JOIN seq_products p ON p.id = t.product_id
    ORDER BY p.slug ASC, t.created_at DESC
  `).all<ApiTokenRow>()

  return c.json((rows.results ?? []).map(formatApiTokenRow))
})

// POST /api/internal/api-tokens
internalRoute.post('/api-tokens', async (c) => {
  const actor = c.get('accessEmail')
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

  const productId = typeof body?.product_id === 'string' ? body.product_id.trim() : ''
  const rawAccessServiceTokenId = body?.access_service_token_id
  if (!productId || rawAccessServiceTokenId === undefined || rawAccessServiceTokenId === null) {
    return c.json({ error: 'product_id and access_service_token_id are required' }, 400)
  }
  if (typeof rawAccessServiceTokenId !== 'string') {
    return c.json(
      {
        error: 'access_service_token_id must be a Cloudflare Access client id ending in .access',
      },
      400,
    )
  }
  const accessServiceTokenId = rawAccessServiceTokenId.trim()
  if (isInvalidAccessServiceTokenSubject(accessServiceTokenId)) {
    return c.json(
      {
        error: 'access_service_token_id must be a Cloudflare Access client id ending in .access',
      },
      400,
    )
  }

  const product = await c.env.DB.prepare(`
    /* internal api token product lookup */
    SELECT id, slug, name
    FROM seq_products
    WHERE id = ?
    LIMIT 1
  `)
    .bind(productId)
    .first<ApiTokenProductRow>()
  if (!product) {
    return c.json({ error: 'Product not found' }, 404)
  }

  const label =
    (typeof body?.label === 'string' ? body.label.trim() : '') || `${product.slug}-service-token`
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(`
      INSERT INTO seq_api_tokens (id, product_id, label, access_service_token_id)
      VALUES (?, ?, ?, ?)
    `)
      .bind(id, product.id, label, accessServiceTokenId)
      .run()
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Access service token is already mapped' }, 409)
    }
    console.error(error)
    return c.json({ error: 'Internal error', code: 'internal_error' }, 500)
  }

  const created = await c.env.DB.prepare(`
    /* internal api token created row */
    SELECT
      t.id,
      t.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      t.label,
      t.access_service_token_id,
      t.created_at,
      t.revoked_at
    FROM seq_api_tokens t
    JOIN seq_products p ON p.id = t.product_id
    WHERE t.id = ?
    LIMIT 1
  `)
    .bind(id)
    .first<ApiTokenRow>()
  const token = formatApiTokenRow(
    created ?? {
      id,
      product_id: product.id,
      product_slug: product.slug,
      product_name: product.name,
      label,
      access_service_token_id: accessServiceTokenId,
      created_at: new Date().toISOString(),
      revoked_at: null,
    },
  )

  await audit(c.env, actor, 'api_token.created', 'api_token', id, null, {
    product_id: product.id,
    label,
    access_service_token_id: accessServiceTokenId,
  })

  return c.json({ ok: true, token }, 201)
})

// POST /api/internal/api-tokens/:id/revoke
internalRoute.post('/api-tokens/:id/revoke', async (c) => {
  const actor = c.get('accessEmail')
  const id = c.req.param('id')
  if (!isUuidLike(id)) return c.json({ error: 'Invalid id' }, 400)
  const existing = await c.env.DB.prepare(`
    /* internal api token revoke lookup */
    SELECT
      t.id,
      t.product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      t.label,
      t.access_service_token_id,
      t.created_at,
      t.revoked_at
    FROM seq_api_tokens t
    JOIN seq_products p ON p.id = t.product_id
    WHERE t.id = ?
    LIMIT 1
  `)
    .bind(id)
    .first<ApiTokenRow>()

  if (!existing || existing.revoked_at) {
    return c.json({ error: 'Active API token mapping not found' }, 404)
  }

  const revokedAt = new Date().toISOString()
  const update = await c.env.DB.prepare(`
    UPDATE seq_api_tokens SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `)
    .bind(revokedAt, id)
    .run()
  if (d1ChangedRows(update) === 0) {
    return c.json({ error: 'Active API token mapping not found' }, 404)
  }

  await audit(
    c.env,
    actor,
    'api_token.revoked',
    'api_token',
    id,
    {
      product_id: existing.product_id,
      label: existing.label,
      access_service_token_id: existing.access_service_token_id,
    },
    {
      product_id: existing.product_id,
      label: existing.label,
      access_service_token_id: existing.access_service_token_id,
      revoked_at: revokedAt,
    },
  )

  return c.json({ ok: true })
})

// GET /api/internal/templates/:slug/preview
internalRoute.get('/templates/:slug/preview', previewTemplate)
internalRoute.get('/templates/*/preview', previewTemplate)

async function previewTemplate(c: PreviewContext) {
  const slug = extractTemplateSlug(c.req.path)
  if (!slug) return c.json({ error: 'Template slug is required' }, 400)

  const { TemplateNotFoundError, renderEmailForTemplate } = await import(
    '../../lib/template-renderer'
  )
  const scopedProps = await buildScopedTemplatePreviewProps(c, slug)
  if (!scopedProps.ok) {
    return c.json({ error: scopedProps.error }, scopedProps.status)
  }

  let rendered: { html: string; text: string }
  try {
    const previewProps: TemplateProps & Record<string, unknown> = {
      firstName: 'Preview',
      email: 'preview@example.com',
      productName: 'Ventora',
      assetUrl: '#',
      unsubscribeUrl: '#',
      ...(scopedProps.value ?? {}),
    }
    rendered = await renderEmailForTemplate(slug, previewProps)
  } catch (error) {
    if (
      error instanceof TemplateNotFoundError ||
      (error as Error).name === 'TemplateNotFoundError'
    ) {
      return c.json({ error: 'Template not found', slug }, 404)
    }
    console.error(error)
    return c.json({ error: 'Internal error', code: 'internal_error' }, 500)
  }

  return c.html(rendered.html)
}

async function buildScopedTemplatePreviewProps(
  c: PreviewContext,
  templateSlug: string,
): Promise<
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; status: 400 | 404 | 503; error: string }
> {
  const productSlug = c.req.query('product')?.trim()
  const sequenceSlug = c.req.query('sequence')?.trim()
  if (!productSlug && !sequenceSlug) return { ok: true, value: null }
  if (!productSlug || !sequenceSlug) {
    return {
      ok: false,
      status: 400,
      error: 'product and sequence are required together for scoped template preview',
    }
  }
  // Allow template preview to render in local dev without the production signing secret.
  const previewSigningSecret =
    c.env.UNSUBSCRIBE_SIGNING_SECRET ??
    (c.env.ENVIRONMENT === 'development' ? 'dev-preview-only-secret' : null)
  if (!previewSigningSecret) {
    return { ok: false, status: 503, error: 'UNSUBSCRIBE_SIGNING_SECRET is not configured' }
  }

  const row = await c.env.DB.prepare(`
    /* internal template preview context */
    SELECT
      s.slug AS sequence_slug,
      s.version AS version,
      s.is_active AS is_active,
      s.definition AS definition,
      p.id AS product_id,
      p.slug AS product_slug,
      p.name AS product_name,
      p.brand_color AS brand_color
    FROM seq_sequences s
    JOIN seq_products p ON p.id = s.product_id
    WHERE s.is_active = 1
      AND p.slug = ?
      AND s.slug = ?
    LIMIT 1
  `)
    .bind(productSlug, sequenceSlug)
    .first<SequenceDefinitionRow>()
  if (!row) return { ok: false, status: 404, error: 'Template preview context not found' }

  const definition = parseSequenceDefinition(row.definition)
  const step =
    definition?.steps
      ?.map(parseTemplateCatalogStep)
      .find(
        (candidate): candidate is TemplateCatalogStepDefinition =>
          candidate?.template === templateSlug,
      ) ?? null
  if (!step) return { ok: false, status: 404, error: 'Template not found in scoped sequence' }

  const subject = extractSubjects(step.subject)[0] ?? 'Preview'
  return {
    ok: true,
    value: await buildEmailTemplateProps({
      contactEmail: 'preview@example.com',
      firstName: 'Preview',
      productSlug: row.product_slug,
      productName: row.product_name,
      brandColor: row.brand_color ?? '#2e7d71',
      subject,
      sequenceSlug: row.sequence_slug,
      unsubscribeSigningSecret: previewSigningSecret,
    }),
  }
}

type TemplateCatalogStepDefinition = {
  id: string
  template: string
  subject: unknown
}

function parseSequenceDefinition(value: unknown): { steps?: unknown[] } | null {
  const parsed = parseSequenceDefinitionObject(value)
  if (!parsed) return null
  if ('steps' in parsed && !Array.isArray(parsed.steps)) return null
  return parsed as { steps?: unknown[] }
}

function parseSequenceDefinitionObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parseSequenceDefinitionObject(parsed)
    } catch {
      return null
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseTemplateCatalogStep(value: unknown): TemplateCatalogStepDefinition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const step = value as Record<string, unknown>
  if (typeof step.id !== 'string' || typeof step.template !== 'string' || !step.template)
    return null
  return { id: step.id, template: step.template, subject: step.subject }
}

function getTemplateKind(slug: string): TemplateCatalogRow['kind'] {
  return slug.startsWith('legacy/camaudit/') ? 'legacy-camaudit' : 'react-email'
}

function extractSubjects(subject: unknown): string[] {
  if (typeof subject === 'string') return [subject]
  if (!subject || typeof subject !== 'object') return []
  return Object.values(subject).filter((value): value is string => typeof value === 'string')
}

function buildTemplatePreviewUrl(
  templateSlug: string,
  productSlug: string,
  sequenceSlug: string,
): string {
  const query = new URLSearchParams({ product: productSlug, sequence: sequenceSlug })
  return `/api/internal/templates/${encodeURIComponent(templateSlug)}/preview?${query.toString()}`
}

function formatContactRow(row: EnrichedContactRow) {
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    properties: parseJsonRecord(row.properties),
    created_at: row.created_at,
    updated_at: row.updated_at,
    memberships: parseJsonArray<ContactMembership>(row.memberships_json),
    active_run: parseJsonObject<ContactActiveRun>(row.active_run_json),
    active_runs: parseJsonArray<ContactActiveRun>(row.active_runs_json),
  }
}

async function selectEnrichedContact(db: D1Database, id: string) {
  const row = await db
    .prepare(`
      SELECT
        c.id,
        c.email,
        c.first_name,
        c.last_name,
        c.properties,
        c.created_at,
        c.updated_at,
        COALESCE((
          SELECT json_group_array(json_object(
            'product_id', membership.product_id,
            'product_slug', membership.product_slug,
            'product_name', membership.product_name,
            'status', membership.status,
            'created_at', membership.created_at,
            'updated_at', membership.updated_at
          ))
          FROM (
            SELECT
              cp.product_id,
              p.slug AS product_slug,
              p.name AS product_name,
              cp.status,
              cp.created_at,
              cp.updated_at
            FROM seq_contact_products cp
            JOIN seq_products p ON p.id = cp.product_id
            WHERE cp.contact_id = c.id
            ORDER BY p.slug ASC
          ) membership
        ), '[]') AS memberships_json,
        (
          SELECT json_object(
            'id', r.id,
            'sequence_slug', r.sequence_slug,
            'sequence_version', r.sequence_version,
            'status', r.status,
            'current_step_index', r.current_step_index,
            'started_at', r.started_at,
            'enrollment_source', r.enrollment_source
          )
          FROM seq_sequence_runs r
          WHERE r.contact_id = c.id
            AND r.status = 'running'
          ORDER BY r.started_at DESC
          LIMIT 1
        ) AS active_run_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', active_run.id,
            'product_id', active_run.product_id,
            'product_slug', active_run.product_slug,
            'product_name', active_run.product_name,
            'sequence_slug', active_run.sequence_slug,
            'sequence_version', active_run.sequence_version,
            'status', active_run.status,
            'current_step_index', active_run.current_step_index,
            'started_at', active_run.started_at,
            'enrollment_source', active_run.enrollment_source
          ))
          FROM (
            SELECT
              r.id,
              r.product_id,
              p.slug AS product_slug,
              p.name AS product_name,
              r.sequence_slug,
              r.sequence_version,
              r.status,
              r.current_step_index,
              r.started_at,
              r.enrollment_source
            FROM seq_sequence_runs r
            JOIN seq_products p ON p.id = r.product_id
            WHERE r.contact_id = c.id
              AND r.status = 'running'
            ORDER BY r.started_at DESC
          ) active_run
        ), '[]') AS active_runs_json
      FROM seq_contacts c
      WHERE c.id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<EnrichedContactRow>()
  return row ? formatContactRow(row) : null
}

function buildContactTimeline(
  runs: Array<Record<string, unknown>>,
  stepRows: Array<Record<string, unknown>>,
  messageRows: Array<Record<string, unknown>>,
  eventRows: Array<Record<string, unknown>>,
): ContactTimelineEntry[] {
  const entries: ContactTimelineEntry[] = []

  for (const run of runs) {
    if (typeof run.started_at === 'string') {
      entries.push({
        kind: 'run.started',
        at: run.started_at,
        run_id: String(run.id),
        status: typeof run.status === 'string' ? run.status : undefined,
      })
    }
    if (typeof run.completed_at === 'string') {
      entries.push({
        kind: 'run.completed',
        at: run.completed_at,
        run_id: String(run.id),
        status: typeof run.status === 'string' ? run.status : undefined,
      })
    }
  }

  for (const step of stepRows) {
    const at = typeof step.sent_at === 'string' ? step.sent_at : step.scheduled_for
    if (typeof at === 'string') {
      const status = typeof step.status === 'string' ? step.status : 'unknown'
      entries.push({
        kind: status === 'sent' ? 'step.sent' : `step.${status}`,
        at,
        run_id: typeof step.run_id === 'string' ? step.run_id : undefined,
        step_id: typeof step.id === 'string' ? step.id : undefined,
        message_id: typeof step.message_id === 'string' ? step.message_id : null,
        status,
      })
    }
  }

  for (const message of messageRows) {
    if (typeof message.sent_at === 'string') {
      entries.push({
        kind: 'message.sent',
        at: message.sent_at,
        step_id: typeof message.step_id === 'string' ? message.step_id : undefined,
        message_id:
          typeof message.resend_message_id === 'string' ? message.resend_message_id : null,
      })
    }
  }

  for (const event of eventRows) {
    if (typeof event.received_at === 'string') {
      const type = typeof event.type === 'string' ? event.type : 'unknown'
      entries.push({
        kind: `event.${type}`,
        at: event.received_at,
        event_id: typeof event.id === 'string' ? event.id : undefined,
        message_id: typeof event.message_id === 'string' ? event.message_id : null,
        type,
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

function normalizeRunRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    variant_assignment: parseJson(row.variant_assignment),
  }
}

function normalizeEventRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    payload: parseJsonRecord(row.payload) ?? {},
  }
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

function formatApiTokenRow(row: ApiTokenRow) {
  return {
    id: row.id,
    product_id: row.product_id,
    product_slug: row.product_slug,
    product_name: row.product_name,
    label: row.label,
    access_service_token_id: row.access_service_token_id,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    active: !row.revoked_at,
  }
}

async function formatLeadMagnetRow(env: Env, row: InternalLeadMagnetRow) {
  const asset = await resolveLeadMagnetAssetStatus(env, row)
  return {
    id: row.id,
    product_id: row.product_id,
    product_slug: row.product_slug,
    product_name: row.product_name,
    slug: row.slug,
    name: row.name,
    asset_r2_bucket: row.asset_r2_bucket,
    asset_r2_key: row.asset_r2_key,
    effective_asset_r2_bucket: asset.effectiveBucket,
    asset_status: asset.status,
    asset_size: asset.size,
    fulfillment_sequence_slug: row.fulfillment_sequence_slug,
    conversion_event_name: row.conversion_event_name,
    active: Boolean(row.active),
    created_at: row.created_at,
  }
}

async function resolveLeadMagnetAssetStatus(
  env: Env,
  row: InternalLeadMagnetRow,
): Promise<{ status: LeadMagnetAssetStatus; size: number | null; effectiveBucket: string | null }> {
  if (!row.asset_r2_key) {
    return { status: 'not_configured', size: null, effectiveBucket: row.asset_r2_bucket }
  }

  const bucketName = row.asset_r2_bucket ?? DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET
  const bucket = getLeadMagnetR2Bucket(env, bucketName)
  if (!bucket) return { status: 'bucket_unbound', size: null, effectiveBucket: bucketName }

  let object: R2Object | null
  try {
    object = await bucket.head(row.asset_r2_key)
  } catch {
    return { status: 'unknown', size: null, effectiveBucket: bucketName }
  }
  if (!object) return { status: 'missing', size: null, effectiveBucket: bucketName }
  return {
    status: 'available',
    size: typeof object.size === 'number' ? object.size : null,
    effectiveBucket: bucketName,
  }
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(concurrency, 1), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        results[currentIndex] = await mapper(items[currentIndex])
      }
    }),
  )

  return results
}

function isInvalidAccessServiceTokenSubject(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.length === 0 ||
    (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
    !/^[0-9a-f]{32}\.access$/i.test(trimmed)
  )
}

function normalizeDashboardEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type LeadMagnetPatch = {
  asset_r2_bucket?: string | null
  asset_r2_key?: string | null
  fulfillment_sequence_slug?: string | null
  conversion_event_name?: string | null
  active?: boolean
}

type ContactCreate = {
  email: string
  first_name: string | null
  last_name: string | null
  product_id: string | null
}

type ContactPatch = {
  email?: string
  first_name?: string | null
  last_name?: string | null
  properties?: string | null
}

type SequencePatch = {
  definition?: Record<string, unknown>
  goal?: string | null
  is_active?: boolean
}

type SequenceCreate = {
  slug: string
  product_id: string
  version: number
  definition: Record<string, unknown>
  goal: string | null
  exit_conditions: Array<{ event: string }>
  is_active: boolean
}

type ProductWrite = Pick<
  InternalProductRow,
  | 'slug'
  | 'name'
  | 'brand_color'
  | 'default_from_email'
  | 'default_reply_to'
  | 'resend_api_key_secret_name'
  | 'suppression_scope'
  | 'firewall_partner_id'
>

function parseProductCreate(
  body: Record<string, unknown>,
): { ok: true; value: ProductWrite } | { ok: false; error: string } {
  const slug = parseProductSlug(body.slug)
  if (!slug)
    return {
      ok: false,
      error: 'slug is required and must use lowercase letters, numbers, and hyphens',
    }
  const name = requiredTrimmedString(body.name)
  if (!name) return { ok: false, error: 'name is required' }
  const brandColor = parseBrandColor(body.brand_color ?? '#000000')
  if (!brandColor) return { ok: false, error: 'brand_color must be a hex color' }
  const fromEmail = parseEmail(body.default_from_email)
  if (!fromEmail) return { ok: false, error: 'default_from_email must be a valid email' }
  const replyTo = parseNullableEmail(body.default_reply_to)
  if (replyTo === undefined)
    return { ok: false, error: 'default_reply_to must be a valid email or null' }
  const resendSecret = requiredTrimmedString(body.resend_api_key_secret_name)
  if (!resendSecret) return { ok: false, error: 'resend_api_key_secret_name is required' }
  const suppressionScope = parseSuppressionScope(body.suppression_scope ?? 'product')
  if (!suppressionScope) return { ok: false, error: 'suppression_scope must be global or product' }
  const firewallPartnerId = Object.hasOwn(body, 'firewall_partner_id')
    ? nullableTrimmedString(body.firewall_partner_id)
    : null
  if (firewallPartnerId === undefined) {
    return { ok: false, error: 'firewall_partner_id must be a string or null' }
  }

  return {
    ok: true,
    value: {
      slug,
      name,
      brand_color: brandColor,
      default_from_email: fromEmail,
      default_reply_to: replyTo,
      resend_api_key_secret_name: resendSecret,
      suppression_scope: suppressionScope,
      firewall_partner_id: firewallPartnerId,
    },
  }
}

function parseProductPatch(
  body: Record<string, unknown>,
): { ok: true; value: Partial<ProductWrite> } | { ok: false; error: string } {
  const value: Partial<ProductWrite> = {}

  if (Object.hasOwn(body, 'slug')) {
    const slug = parseProductSlug(body.slug)
    if (!slug) return { ok: false, error: 'slug must use lowercase letters, numbers, and hyphens' }
    value.slug = slug
  }
  if (Object.hasOwn(body, 'name')) {
    const name = requiredTrimmedString(body.name)
    if (!name) return { ok: false, error: 'name is required' }
    value.name = name
  }
  if (Object.hasOwn(body, 'brand_color')) {
    const brandColor = parseBrandColor(body.brand_color)
    if (!brandColor) return { ok: false, error: 'brand_color must be a hex color' }
    value.brand_color = brandColor
  }
  if (Object.hasOwn(body, 'default_from_email')) {
    const fromEmail = parseEmail(body.default_from_email)
    if (!fromEmail) return { ok: false, error: 'default_from_email must be a valid email' }
    value.default_from_email = fromEmail
  }
  if (Object.hasOwn(body, 'default_reply_to')) {
    const replyTo = parseNullableEmail(body.default_reply_to)
    if (replyTo === undefined)
      return { ok: false, error: 'default_reply_to must be a valid email or null' }
    value.default_reply_to = replyTo
  }
  if (Object.hasOwn(body, 'resend_api_key_secret_name')) {
    const resendSecret = requiredTrimmedString(body.resend_api_key_secret_name)
    if (!resendSecret) return { ok: false, error: 'resend_api_key_secret_name is required' }
    value.resend_api_key_secret_name = resendSecret
  }
  if (Object.hasOwn(body, 'suppression_scope')) {
    const suppressionScope = parseSuppressionScope(body.suppression_scope)
    if (!suppressionScope)
      return { ok: false, error: 'suppression_scope must be global or product' }
    value.suppression_scope = suppressionScope
  }
  if (Object.hasOwn(body, 'firewall_partner_id')) {
    const firewallPartnerId = nullableTrimmedString(body.firewall_partner_id)
    if (firewallPartnerId === undefined) {
      return { ok: false, error: 'firewall_partner_id must be a string or null' }
    }
    value.firewall_partner_id = firewallPartnerId
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'No supported product fields provided' }
  }
  return { ok: true, value }
}

function parseProductSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : null
}

function productIdFromSlug(slug: string): string {
  return `prod_${slug.replace(/-/g, '_')}`
}

function parseBrandColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null
}

function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

function parseNullableEmail(value: unknown): string | null | undefined {
  const parsed = nullableTrimmedString(value)
  if (parsed === null) return null
  if (parsed === undefined) return undefined
  return parseEmail(parsed) ?? undefined
}

function parseSuppressionScope(value: unknown): 'global' | 'product' | null {
  return value === 'global' || value === 'product' ? value : null
}

function parseSequenceCreate(
  body: Record<string, unknown>,
): { ok: true; value: SequenceCreate } | { ok: false; error: string } {
  const slug = parseSequenceSlug(body.slug)
  if (!slug)
    return {
      ok: false,
      error: 'slug is required and must use lowercase letters, numbers, and hyphens',
    }
  const productId = requiredTrimmedString(body.product_id)
  if (!productId) return { ok: false, error: 'product_id is required' }
  if (!isPlainObject(body.definition)) {
    return { ok: false, error: 'definition must be an object' }
  }

  const goal = Object.hasOwn(body, 'goal') ? nullableTrimmedString(body.goal) : null
  if (goal === undefined) return { ok: false, error: 'goal must be a string or null' }
  if (Object.hasOwn(body, 'is_active') && typeof body.is_active !== 'boolean') {
    return { ok: false, error: 'is_active must be a boolean' }
  }
  const version = Object.hasOwn(body, 'version') ? parsePositiveInteger(body.version) : 1
  if (version === null) return { ok: false, error: 'version must be a positive integer' }

  return {
    ok: true,
    value: {
      slug,
      product_id: productId,
      version,
      definition: body.definition,
      goal,
      exit_conditions: [],
      is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
    },
  }
}

function parseSequencePatch(
  body: Record<string, unknown>,
): { ok: true; value: SequencePatch } | { ok: false; error: string } {
  const value: SequencePatch = {}

  if (Object.hasOwn(body, 'goal')) {
    const goal = nullableTrimmedString(body.goal)
    if (goal === undefined) return { ok: false, error: 'goal must be a string or null' }
    value.goal = goal
  }

  if (Object.hasOwn(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') {
      return { ok: false, error: 'is_active must be a boolean' }
    }
    value.is_active = body.is_active
  }

  if (Object.hasOwn(body, 'definition')) {
    if (!isPlainObject(body.definition)) {
      return { ok: false, error: 'definition must be an object' }
    }
    value.definition = body.definition
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'No supported sequence fields provided' }
  }

  return { ok: true, value }
}

function parseSequenceSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : null
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

type LeadMagnetCreate = {
  product_id: string
  slug: string
  name: string
  asset_r2_bucket: string | null
  asset_r2_key: string | null
  fulfillment_sequence_slug: string | null
  conversion_event_name: string | null
  active: boolean
}

function parseLeadMagnetCreate(
  body: Record<string, unknown>,
): { ok: true; value: LeadMagnetCreate } | { ok: false; error: string } {
  const productId = requiredTrimmedString(body.product_id)
  if (!productId) return { ok: false, error: 'product_id is required' }
  const slug = requiredTrimmedString(body.slug)
  if (!slug) return { ok: false, error: 'slug is required' }
  const name = requiredTrimmedString(body.name)
  if (!name) return { ok: false, error: 'name is required' }

  const optional: Pick<
    LeadMagnetCreate,
    'asset_r2_bucket' | 'asset_r2_key' | 'fulfillment_sequence_slug' | 'conversion_event_name'
  > = {
    asset_r2_bucket: null,
    asset_r2_key: null,
    fulfillment_sequence_slug: null,
    conversion_event_name: null,
  }
  for (const field of [
    'asset_r2_bucket',
    'asset_r2_key',
    'fulfillment_sequence_slug',
    'conversion_event_name',
  ] as const) {
    if (!Object.hasOwn(body, field)) continue
    const parsed = nullableTrimmedString(body[field])
    if (parsed === undefined) return { ok: false, error: `${field} must be a string or null` }
    optional[field] = parsed
  }

  if (Object.hasOwn(body, 'active') && typeof body.active !== 'boolean') {
    return { ok: false, error: 'active must be a boolean' }
  }

  return {
    ok: true,
    value: {
      product_id: productId,
      slug,
      name,
      ...optional,
      active: typeof body.active === 'boolean' ? body.active : true,
    },
  }
}

function parseLeadMagnetPatch(
  body: Record<string, unknown>,
): { ok: true; value: LeadMagnetPatch } | { ok: false; error: string } {
  const value: LeadMagnetPatch = {}
  for (const field of [
    'asset_r2_bucket',
    'asset_r2_key',
    'fulfillment_sequence_slug',
    'conversion_event_name',
  ] as const) {
    if (!Object.hasOwn(body, field)) continue
    const parsed = nullableTrimmedString(body[field])
    if (parsed === undefined) return { ok: false, error: `${field} must be a string or null` }
    value[field] = parsed
  }
  if (Object.hasOwn(body, 'active')) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be a boolean' }
    value.active = body.active
  }
  if (Object.keys(value).length === 0)
    return { ok: false, error: 'No supported lead magnet fields provided' }
  return { ok: true, value }
}

function parseContactCreate(
  body: Record<string, unknown>,
): { ok: true; value: ContactCreate } | { ok: false; error: string } {
  const email = parseEmail(body.email)
  if (!email) return { ok: false, error: 'email must be a valid email address' }
  const firstName = nullableTrimmedString(body.first_name ?? null)
  if (firstName === undefined) return { ok: false, error: 'first_name must be a string or null' }
  const lastName = nullableTrimmedString(body.last_name ?? null)
  if (lastName === undefined) return { ok: false, error: 'last_name must be a string or null' }
  const productId = nullableTrimmedString(body.product_id ?? null)
  if (productId === undefined) return { ok: false, error: 'product_id must be a string or null' }
  return {
    ok: true,
    value: { email, first_name: firstName, last_name: lastName, product_id: productId },
  }
}

function parseContactPatch(
  body: Record<string, unknown>,
): { ok: true; value: ContactPatch } | { ok: false; error: string } {
  const value: ContactPatch = {}
  if (Object.hasOwn(body, 'email')) {
    const email = parseEmail(body.email)
    if (!email) return { ok: false, error: 'email must be a valid email address' }
    value.email = email
  }
  if (Object.hasOwn(body, 'first_name')) {
    const firstName = nullableTrimmedString(body.first_name)
    if (firstName === undefined) return { ok: false, error: 'first_name must be a string or null' }
    value.first_name = firstName
  }
  if (Object.hasOwn(body, 'last_name')) {
    const lastName = nullableTrimmedString(body.last_name)
    if (lastName === undefined) return { ok: false, error: 'last_name must be a string or null' }
    value.last_name = lastName
  }
  if (Object.hasOwn(body, 'properties')) {
    if (body.properties === null) {
      value.properties = null
    } else if (isPlainObject(body.properties)) {
      value.properties = JSON.stringify(body.properties)
    } else {
      return { ok: false, error: 'properties must be an object or null' }
    }
  }
  if (Object.keys(value).length === 0)
    return { ok: false, error: 'No supported contact fields provided' }
  return { ok: true, value }
}

function requiredTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function nullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function nullableDbString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function formatLeadMagnetAuditState(
  row: Partial<InternalLeadMagnetRow> & {
    asset_status?: LeadMagnetAssetStatus
    effective_asset_r2_bucket?: string | null
    asset_size?: number | null
  },
) {
  return {
    product_id: row.product_id,
    slug: row.slug,
    asset_r2_bucket: row.asset_r2_bucket ?? null,
    asset_r2_key: row.asset_r2_key ?? null,
    fulfillment_sequence_slug: row.fulfillment_sequence_slug ?? null,
    conversion_event_name: row.conversion_event_name ?? null,
    active: Boolean(row.active),
  }
}

function formatSequenceAuditState(row: InternalSequenceRow) {
  return {
    slug: row.slug,
    product_id: row.product_id,
    version: row.version,
    definition: parseJsonRecord(row.definition) ?? {},
    goal: row.goal ?? null,
    exit_conditions: Array.isArray(parseJson(row.exit_conditions))
      ? parseJson(row.exit_conditions)
      : [],
    is_active: Boolean(row.is_active),
    compiled_at: row.compiled_at,
    compiled_from_sha: row.compiled_from_sha ?? null,
  }
}

async function selectInternalProduct(
  db: D1Database,
  id: string,
): Promise<InternalProductRow | null> {
  return await db
    .prepare(`
      SELECT
        id,
        slug,
        name,
        brand_color,
        default_from_email,
        default_reply_to,
        resend_api_key_secret_name,
        suppression_scope,
        firewall_partner_id,
        created_at,
        updated_at
      FROM seq_products
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<InternalProductRow>()
}

async function selectInternalSequence(
  db: D1Database,
  slug: string,
): Promise<InternalSequenceRow | null> {
  return await db
    .prepare(`
      SELECT
        slug,
        product_id,
        version,
        definition,
        goal,
        exit_conditions,
        is_active,
        compiled_at,
        compiled_from_sha
      FROM seq_sequences
      WHERE slug = ?
      LIMIT 1
    `)
    .bind(slug)
    .first<InternalSequenceRow>()
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message)
}

function d1ChangedRows(result: D1Result<unknown>): number {
  if (typeof result.meta?.changes === 'number') return result.meta.changes
  if (typeof result.meta?.rows_written === 'number') return result.meta.rows_written
  return 1
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseJson(value)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null
  const parsed = parseJson(value)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as T)
    : null
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return []
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function extractTemplateSlug(path: string): string | null {
  const start = path.indexOf('/templates/')
  const end = path.lastIndexOf('/preview')
  if (start === -1 || end === -1 || end <= start + '/templates/'.length) return null
  try {
    return decodeURIComponent(path.slice(start + '/templates/'.length, end))
  } catch (_) {
    return null
  }
}

type PreviewContext = Context<{ Bindings: Env }>

export { internalRoute }
