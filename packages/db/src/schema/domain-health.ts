import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const domain_health = sqliteTable(
  'seq_domain_health',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    domain: text('domain').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    sent: integer('sent').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    bounced: integer('bounced').notNull().default(0),
    complained: integer('complained').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    clicked: integer('clicked').notNull().default(0),
    unsubscribed: integer('unsubscribed').notNull().default(0),
  },
  (table) => ({
    domainDateIdx: index('idx_domain_health_domain_date').on(table.domain, table.date),
  }),
)
