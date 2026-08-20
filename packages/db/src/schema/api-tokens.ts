import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const api_tokens = sqliteTable('seq_api_tokens', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  product_id: text('product_id').notNull(),
  label: text('label').notNull(),
  access_service_token_id: text('access_service_token_id').notNull().unique(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  revoked_at: text('revoked_at'),
})
