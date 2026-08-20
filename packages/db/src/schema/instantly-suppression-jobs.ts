import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const instantly_suppression_jobs = sqliteTable(
  'seq_instantly_suppression_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    job_key: text('job_key').notNull(),
    email: text('email').notNull(),
    product: text('product').notNull(),
    event_type: text('event_type').notNull(),
    properties: text('properties', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', {
      enum: ['pending', 'running', 'succeeded', 'failed', 'dead'],
    })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(8),
    last_error: text('last_error'),
    result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
    next_attempt_at: text('next_attempt_at'),
    locked_at: text('locked_at'),
    completed_at: text('completed_at'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    jobKeyUniqueIdx: uniqueIndex('idx_instantly_suppression_jobs_job_key').on(table.job_key),
    statusNextAttemptIdx: index('idx_instantly_suppression_jobs_status_next').on(
      table.status,
      table.next_attempt_at,
    ),
    emailProductIdx: index('idx_instantly_suppression_jobs_email_product').on(
      table.email,
      table.product,
    ),
  }),
)
