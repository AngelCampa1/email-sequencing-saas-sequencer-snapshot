import { sql } from 'drizzle-orm'
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const contacts = sqliteTable('seq_contacts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(), // always stored lowercase
  first_name: text('first_name'),
  last_name: text('last_name'),
  properties: text('properties', { mode: 'json' }).$type<Record<string, unknown>>(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const contact_sources = sqliteTable('seq_contact_sources', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  contact_id: text('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  product_id: text('product_id').notNull(), // no direct .references() to avoid circular import
  lead_magnet_id: text('lead_magnet_id'),
  source: text('source'),
  captured_at: text('captured_at').notNull().default(sql`(datetime('now'))`),
  utm: text('utm', { mode: 'json' }).$type<Record<string, string>>(),
})

export const contact_products = sqliteTable(
  'seq_contact_products',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contact_id: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    product_id: text('product_id').notNull(),
    first_name: text('first_name'),
    last_name: text('last_name'),
    properties: text('properties', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['active', 'unsubscribed', 'bounced', 'complained'] })
      .notNull()
      .default('active'),
    unsubscribed_at: text('unsubscribed_at'),
    unsubscribe_scope: text('unsubscribe_scope', { enum: ['product', 'global'] }),
    notes: text('notes'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_contact_products_contact_product_unique').on(
      table.contact_id,
      table.product_id,
    ),
  ],
)
