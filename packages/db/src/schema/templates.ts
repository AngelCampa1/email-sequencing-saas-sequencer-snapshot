import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const templates = sqliteTable('seq_templates', {
  slug: text('slug').primaryKey(),
  product_id: text('product_id').notNull(),
  react_email_path: text('react_email_path').notNull(),
  subject_template: text('subject_template').notNull(),
  last_compiled_at: text('last_compiled_at').notNull().default(sql`(datetime('now'))`),
})
