import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const suppressions = sqliteTable(
  'seq_suppressions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text('email').notNull(), // lowercased
    scope: text('scope', { enum: ['global', 'product'] }).notNull(),
    product_id: text('product_id'),
    reason: text('reason'),
    source: text('source', {
      enum: [
        'manual',
        'webhook',
        'list_import',
        'complaint',
        'bounce',
        'suppression',
        'instantly_webhook',
      ],
    })
      .notNull()
      .default('manual'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    emailIdx: index('idx_suppressions_email').on(table.email),
    emailScopeIdx: index('idx_suppressions_email_scope').on(table.email, table.scope),
    globalUniqueIdx: uniqueIndex('idx_suppressions_global_unique')
      .on(table.email)
      .where(sql`${table.scope} = 'global'`),
    productUniqueIdx: uniqueIndex('idx_suppressions_product_unique')
      .on(table.email, table.product_id)
      .where(sql`${table.scope} = 'product' AND ${table.product_id} IS NOT NULL`),
  }),
)
