import { contact_products, contacts, createDb, products } from '@sequencer/db'
import { ListMembershipRequestSchema } from '@sequencer/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createOrLoadContactByEmail } from '../../../lib/contact-upsert'
import { ensureListMembership } from '../../../lib/lists'
import { createLogger } from '../../../lib/observability'
import { requireProductApiClientContext } from '../../../lib/product-api-auth'
import { checkSuppression } from '../../../lib/suppression'
import type { Env } from '../../../types'

export const listsRoute = new Hono<{ Bindings: Env }>()

listsRoute.post('/', async (c) => {
  const apiClient = await requireProductApiClientContext(c)
  if (apiClient instanceof Response) return apiClient

  const callerProduct = apiClient.productSlug
  const logger = createLogger(c.env, { actor: `api:${apiClient.clientId}` })
  const body = await c.req.json().catch(() => null)
  const parsed = ListMembershipRequestSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)
  }

  const { email, list_slug, list_name, properties } = parsed.data
  const db = createDb(c.env.DB)

  // Load product
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.slug, callerProduct))
    .limit(1)

  if (!product) {
    return c.json({ error: 'Product not found' }, 404)
  }

  const normalizedEmail = email.toLowerCase()

  // Suppression check - do not add suppressed contacts to lists
  const suppCheck = await checkSuppression(c.env, normalizedEmail, product.id)
  if (suppCheck.suppressed) {
    logger.info('List add blocked: suppressed', { email: normalizedEmail, list_slug })
    return c.json({ error: 'Contact is suppressed', scope: suppCheck.scope }, 422)
  }

  // Upsert contact
  const [existingContact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, normalizedEmail))
    .limit(1)

  let contact: typeof existingContact
  if (existingContact) {
    contact = existingContact
  } else {
    const result = await createOrLoadContactByEmail(db, {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      properties,
    })
    contact = result.contact
  }

  // Ensure contact_product association is active
  const [assoc] = await db
    .select()
    .from(contact_products)
    .where(
      and(eq(contact_products.contact_id, contact.id), eq(contact_products.product_id, product.id)),
    )
    .limit(1)

  if (!assoc) {
    await db
      .insert(contact_products)
      .values({ contact_id: contact.id, product_id: product.id, properties })
      .onConflictDoNothing()
  } else if (assoc.status !== 'active') {
    return c.json({ error: 'Contact is not active for this product' }, 422)
  }

  // Add to list
  await ensureListMembership(db, {
    productId: product.id,
    listSlug: list_slug,
    listName: list_name ?? list_slug,
    contactId: contact.id,
    source: 'api',
  })

  logger.info('List member added', { email: normalizedEmail, list_slug })

  return c.json({ list_slug, status: 'added' }, 201)
})
