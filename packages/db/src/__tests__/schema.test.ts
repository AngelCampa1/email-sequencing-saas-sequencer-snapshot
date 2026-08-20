import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  audit_log,
  contact_products,
  contact_sources,
  contacts,
  events,
  instantly_campaign_daily_stats,
  instantly_campaigns,
  messages,
  products,
  rate_limit_windows,
  sequence_runs,
  steps,
  suppressions,
} from '../index'

describe('schema table names', () => {
  it('all tables have seq_ prefix', () => {
    const tables = [products, contacts, suppressions, sequence_runs, audit_log, rate_limit_windows]
    for (const table of tables) {
      expect(getTableName(table)).toMatch(/^seq_/)
    }
  })
})

describe('firewall config', () => {
  it('PRODUCT_FIREWALL has no live product partners after product retirement', async () => {
    const { PRODUCT_FIREWALL } = await import('@sequencer/shared')
    expect(PRODUCT_FIREWALL).toEqual({})
  })
})

describe('suppression uniqueness', () => {
  it('enforces one global and one product suppression per email scope', () => {
    const indexes = getTableConfig(suppressions).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(indexes).toContainEqual({
      name: 'idx_suppressions_global_unique',
      unique: true,
    })
    expect(indexes).toContainEqual({
      name: 'idx_suppressions_product_unique',
      unique: true,
    })
  })
})

describe('event webhook uniqueness', () => {
  it('deduplicates provider webhook deliveries by provider event id without collapsing Resend message events', () => {
    const indexes = getTableConfig(events).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))
    const columns = getTableConfig(events).columns.map((column) => column.name)

    expect(columns).toContain('provider_event_id')
    expect(columns).toContain('side_effects_started_at')
    expect(columns).toContain('side_effects_completed_at')
    expect(indexes).toContainEqual({
      name: 'idx_events_provider_event_unique',
      unique: true,
    })
    expect(indexes).toContainEqual({
      name: 'idx_events_instantly_message_type_unique',
      unique: true,
    })
  })
})

describe('contact product membership uniqueness', () => {
  it('enforces one product membership per contact', () => {
    const indexes = getTableConfig(contact_products).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(indexes).toContainEqual({
      name: 'idx_contact_products_contact_product_unique',
      unique: true,
    })
  })

  it('stores product-scoped contact profile fields on the membership', () => {
    const columns = getTableConfig(contact_products).columns.map((column) => column.name)

    expect(columns).toEqual(expect.arrayContaining(['first_name', 'last_name', 'properties']))
  })
})

describe('message delivery tracking', () => {
  it('persists Resend delivery timestamps for domain health rollups', () => {
    const columns = getTableConfig(messages).columns.map((column) => column.name)

    expect(columns).toContain('delivered_at')
    expect(columns).toContain('suppressed_at')
    expect(columns).toContain('failed_at')
    expect(columns).toContain('failure_reason')
  })
})

describe('rate limit windows', () => {
  it('stores API rate limit counters by primary key with an expiry index', () => {
    const indexes = getTableConfig(rate_limit_windows).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(getTableConfig(rate_limit_windows).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'key',
        'client_id',
        'endpoint',
        'window_start_ms',
        'window_end_ms',
        'count',
      ]),
    )
    expect(indexes).toContainEqual({
      name: 'idx_rate_limit_windows_expires',
      unique: false,
    })
  })
})

describe('send idempotency uniqueness', () => {
  it('enforces one step per run index and one message per step', () => {
    const stepIndexes = getTableConfig(steps).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))
    const messageIndexes = getTableConfig(messages).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(stepIndexes).toContainEqual({
      name: 'idx_steps_run_step_unique',
      unique: true,
    })
    expect(messageIndexes).toContainEqual({
      name: 'idx_messages_step_unique',
      unique: true,
    })
  })
})

describe('sequence run product scoping', () => {
  it('stores product identity on each run and enforces one running run per contact per product', () => {
    const columns = getTableConfig(sequence_runs).columns.map((column) => column.name)
    const indexes = getTableConfig(sequence_runs).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(columns).toContain('product_id')
    expect(indexes).toContainEqual({
      name: 'idx_runs_one_running_per_contact_product',
      unique: true,
    })
  })
})

describe('lead magnet source attribution', () => {
  it('persists the product-provided source label for lead magnet captures', () => {
    const columns = getTableConfig(contact_sources).columns.map((column) => column.name)

    expect(columns).toContain('source')
  })
})

describe('Instantly campaign mapping', () => {
  it('can map provider campaign ids back to Sequencer products', () => {
    const columns = getTableConfig(instantly_campaigns).columns.map((column) => column.name)
    const indexes = getTableConfig(instantly_campaigns).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(columns).toContain('product_id')
    expect(indexes).toContainEqual({
      name: 'idx_instantly_campaigns_product',
      unique: false,
    })
  })

  it('stores at most one stats row per campaign and date', () => {
    const indexes = getTableConfig(instantly_campaign_daily_stats).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }))

    expect(indexes).toContainEqual({
      name: 'idx_instantly_stats_campaign_date',
      unique: true,
    })
  })
})
