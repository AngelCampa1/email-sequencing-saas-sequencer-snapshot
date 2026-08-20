import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const instantly_campaigns = sqliteTable(
  'seq_instantly_campaigns',
  {
    id: text('id').primaryKey(), // Instantly campaign ID
    product_id: text('product_id'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    created_at_instantly: text('created_at_instantly'),
    synced_at: text('synced_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    productIdx: index('idx_instantly_campaigns_product').on(table.product_id),
  }),
)

export const instantly_campaign_daily_stats = sqliteTable(
  'seq_instantly_campaign_daily_stats',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaign_id: text('campaign_id').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    sent: integer('sent').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    replied: integer('replied').notNull().default(0),
    interested: integer('interested').notNull().default(0),
    bounced: integer('bounced').notNull().default(0),
    synced_at: text('synced_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    campaignDateIdx: uniqueIndex('idx_instantly_stats_campaign_date').on(
      table.campaign_id,
      table.date,
    ),
  }),
)
