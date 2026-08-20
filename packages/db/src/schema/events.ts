import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const events = sqliteTable(
  'seq_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text('provider', { enum: ['resend', 'instantly', 'internal'] }).notNull(),
    provider_event_id: text('provider_event_id'),
    message_id: text('message_id'),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    received_at: text('received_at').notNull().default(sql`(datetime('now'))`),
    side_effects_started_at: text('side_effects_started_at'),
    side_effects_completed_at: text('side_effects_completed_at'),
  },
  (table) => ({
    messageIdx: index('idx_events_message_id').on(table.message_id),
    providerEventUniqueIdx: uniqueIndex('idx_events_provider_event_unique')
      .on(table.provider, table.provider_event_id)
      .where(sql`${table.provider_event_id} IS NOT NULL`),
    instantlyMessageTypeUniqueIdx: uniqueIndex('idx_events_instantly_message_type_unique')
      .on(table.provider, table.message_id, table.type)
      .where(sql`${table.message_id} IS NOT NULL AND ${table.provider} = 'instantly'`),
    providerMessageIdx: index('idx_events_provider_message').on(
      table.provider,
      table.message_id,
      table.received_at,
    ),
    internalPayloadIdx: index('idx_events_internal_payload').on(
      table.provider,
      sql`json_extract(${table.payload}, '$.email')`,
      sql`json_extract(${table.payload}, '$.product')`,
      table.received_at,
    ),
    typeIdx: index('idx_events_type').on(table.type, table.received_at),
  }),
)
