import type { SequenceDefinition } from '@sequencer/shared'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sequences = sqliteTable('seq_sequences', {
  slug: text('slug').primaryKey(),
  product_id: text('product_id').notNull(),
  version: integer('version').notNull(),
  definition: text('definition', { mode: 'json' }).$type<SequenceDefinition>().notNull(),
  goal: text('goal'),
  exit_conditions: text('exit_conditions', { mode: 'json' })
    .$type<Array<{ event: string }>>()
    .notNull()
    .default(sql`'[]'`),
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  compiled_at: text('compiled_at').notNull().default(sql`(datetime('now'))`),
  compiled_from_sha: text('compiled_from_sha'),
})
