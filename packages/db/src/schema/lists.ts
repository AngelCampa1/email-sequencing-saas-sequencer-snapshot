import { sql } from 'drizzle-orm'
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { contacts } from './contacts'

export const lists = sqliteTable(
  'seq_lists',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    product_id: text('product_id').notNull(), // no direct .references() to avoid circular import
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex('idx_lists_product_slug').on(table.product_id, table.slug)],
)

export const list_members = sqliteTable(
  'seq_list_members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    list_id: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    contact_id: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['subscribed', 'unsubscribed'] })
      .notNull()
      .default('subscribed'),
    source: text('source'), // e.g. 'enrollment' | 'api' | 'import'
    added_at: text('added_at').notNull().default(sql`(datetime('now'))`),
    unsubscribed_at: text('unsubscribed_at'),
  },
  (table) => [uniqueIndex('idx_list_members_list_contact').on(table.list_id, table.contact_id)],
)
