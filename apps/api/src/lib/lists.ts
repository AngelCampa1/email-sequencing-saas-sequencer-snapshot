import { list_members, lists } from '@sequencer/db'
import { and, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

export interface EnsureListMembershipOptions {
  productId: string
  listSlug: string
  listName: string
  contactId: string
  source?: string
}

export interface EnsureListMembershipResult {
  list_id: string
  member_id: string
}

/**
 * Idempotently upserts a named list for the product and adds the contact as a
 * member. Safe to call multiple times - subsequent calls are no-ops.
 */
export async function ensureListMembership(
  db: DrizzleD1Database,
  options: EnsureListMembershipOptions,
): Promise<EnsureListMembershipResult> {
  const { productId, listSlug, listName, contactId, source } = options

  // Upsert the list row
  await db
    .insert(lists)
    .values({
      product_id: productId,
      slug: listSlug,
      name: listName,
    })
    .onConflictDoNothing()

  // Load the (now-guaranteed) list id
  const [listRow] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.product_id, productId), eq(lists.slug, listSlug)))
    .limit(1)

  const listId = listRow!.id

  // Upsert the membership row
  await db
    .insert(list_members)
    .values({
      list_id: listId,
      contact_id: contactId,
      source: source ?? null,
    })
    .onConflictDoNothing()

  // Load the (now-guaranteed) member id
  const [memberRow] = await db
    .select({ id: list_members.id })
    .from(list_members)
    .where(and(eq(list_members.list_id, listId), eq(list_members.contact_id, contactId)))
    .limit(1)

  return { list_id: listId, member_id: memberRow!.id }
}
