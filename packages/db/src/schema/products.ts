import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const products = sqliteTable('seq_products', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  brand_color: text('brand_color').notNull().default('#000000'),
  default_from_email: text('default_from_email').notNull(),
  default_reply_to: text('default_reply_to'),
  resend_api_key_secret_name: text('resend_api_key_secret_name').notNull(),
  suppression_scope: text('suppression_scope', { enum: ['global', 'product'] })
    .notNull()
    .default('product'),
  firewall_partner_id: text('firewall_partner_id'), // references products.id
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
})
