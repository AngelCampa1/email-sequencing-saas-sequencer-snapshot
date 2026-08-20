import { contact_products, contacts, createDb, products } from '@sequencer/db'
import { and, eq } from 'drizzle-orm'
import type { Env } from '../types'
import { createLogger } from './observability'

export interface FirewallCheckResult {
  blocked: boolean
  reason?: string
}

export async function checkFirewall(
  env: Env,
  contactEmail: string,
  targetProductId: string,
): Promise<FirewallCheckResult> {
  const db = createDb(env.DB)
  const logger = createLogger(env)

  // Get the target product's firewall partner (if any)
  const [targetProduct] = await db
    .select({ firewall_partner_id: products.firewall_partner_id })
    .from(products)
    .where(eq(products.id, targetProductId))
    .limit(1)

  if (!targetProduct?.firewall_partner_id) {
    return { blocked: false }
  }

  const partnerId = targetProduct.firewall_partner_id

  // Check if this contact is already associated with the partner product
  const blocked = await db
    .select({ id: contact_products.id })
    .from(contact_products)
    .innerJoin(contacts, eq(contacts.id, contact_products.contact_id))
    .where(
      and(
        eq(contacts.email, contactEmail.toLowerCase()),
        eq(contact_products.product_id, partnerId),
      ),
    )
    .limit(1)

  if (blocked.length > 0) {
    logger.warn('Firewall block', {
      email: contactEmail,
      target: targetProductId,
      partner: partnerId,
    })
    return {
      blocked: true,
      reason: `Firewall: contact is associated with partner product ${partnerId}`,
    }
  }

  return { blocked: false }
}
