import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const sequence_runs = sqliteTable(
  'seq_sequence_runs',
  {
    id: text('id').primaryKey(), // also the Durable Object name
    contact_id: text('contact_id').notNull(),
    product_id: text('product_id').notNull(),
    sequence_slug: text('sequence_slug').notNull(),
    sequence_version: integer('sequence_version').notNull(),
    status: text('status', { enum: ['running', 'completed', 'exited', 'errored', 'paused'] })
      .notNull()
      .default('running'),
    current_step_index: integer('current_step_index').notNull().default(0),
    started_at: text('started_at').notNull().default(sql`(datetime('now'))`),
    completed_at: text('completed_at'),
    variant_assignment: text('variant_assignment', { mode: 'json' }).$type<{
      variant_id: string
    } | null>(),
    enrollment_source: text('enrollment_source').notNull().default('api'),
  },
  (table) => ({
    contactIdx: index('idx_runs_contact').on(table.contact_id),
    sequenceIdx: index('idx_runs_sequence').on(table.sequence_slug, table.status),
    oneRunningPerContactProductIdx: uniqueIndex('idx_runs_one_running_per_contact_product')
      .on(table.contact_id, table.product_id)
      .where(sql`${table.status} = 'running'`),
  }),
)

export const steps = sqliteTable(
  'seq_steps',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    run_id: text('run_id').notNull(),
    step_index: integer('step_index').notNull(),
    scheduled_for: text('scheduled_for').notNull(),
    sent_at: text('sent_at'),
    message_id: text('message_id'),
    template_slug: text('template_slug').notNull(),
    variant: text('variant'),
    status: text('status', { enum: ['pending', 'sent', 'skipped', 'failed'] })
      .notNull()
      .default('pending'),
    error: text('error'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    runIdx: uniqueIndex('idx_steps_run_step_unique').on(table.run_id, table.step_index),
  }),
)
