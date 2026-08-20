import { sql } from 'drizzle-orm'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const audit_log = sqliteTable(
  'seq_audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    actor: text('actor').notNull(), // email, 'system', or 'api:<product>'
    action: text('action').notNull(),
    target_type: text('target_type').notNull(),
    target_id: text('target_id'),
    before: text('before', { mode: 'json' }).$type<unknown>(),
    after: text('after', { mode: 'json' }).$type<unknown>(),
    at: text('at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    actorIdx: index('idx_audit_actor').on(table.actor),
    targetIdx: index('idx_audit_target').on(table.target_type, table.target_id),
    atIdx: index('idx_audit_at').on(table.at),
  }),
)
