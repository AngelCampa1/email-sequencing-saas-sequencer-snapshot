import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const rate_limit_windows = sqliteTable(
  'seq_rate_limit_windows',
  {
    key: text('key').primaryKey(),
    client_id: text('client_id').notNull(),
    endpoint: text('endpoint').notNull(),
    window_start_ms: integer('window_start_ms').notNull(),
    window_end_ms: integer('window_end_ms').notNull(),
    count: integer('count').notNull().default(0),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    expiresIdx: index('idx_rate_limit_windows_expires').on(table.window_end_ms),
  }),
)
