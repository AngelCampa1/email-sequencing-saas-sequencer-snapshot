import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const lead_magnets = sqliteTable('seq_lead_magnets', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  product_id: text('product_id').notNull(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  asset_r2_bucket: text('asset_r2_bucket'),
  asset_r2_key: text('asset_r2_key'),
  fulfillment_sequence_slug: text('fulfillment_sequence_slug'),
  conversion_event_name: text('conversion_event_name'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
})
