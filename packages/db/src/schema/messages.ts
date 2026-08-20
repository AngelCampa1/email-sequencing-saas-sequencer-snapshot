import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const messages = sqliteTable(
  'seq_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    step_id: text('step_id').notNull(),
    contact_id: text('contact_id').notNull(),
    product_id: text('product_id').notNull(),
    resend_message_id: text('resend_message_id'),
    subject: text('subject').notNull(),
    from_email: text('from_email').notNull(),
    html_r2_key: text('html_r2_key'),
    sent_at: text('sent_at'),
    delivered_at: text('delivered_at'),
    opened_at: text('opened_at'),
    first_clicked_at: text('first_clicked_at'),
    replied_at: text('replied_at'),
    bounced_at: text('bounced_at'),
    complained_at: text('complained_at'),
    suppressed_at: text('suppressed_at'),
    failed_at: text('failed_at'),
    failure_reason: text('failure_reason'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    contactIdx: index('idx_messages_contact').on(table.contact_id),
    resendIdx: index('idx_messages_resend_id').on(table.resend_message_id),
    stepUniqueIdx: uniqueIndex('idx_messages_step_unique').on(table.step_id),
  }),
)
