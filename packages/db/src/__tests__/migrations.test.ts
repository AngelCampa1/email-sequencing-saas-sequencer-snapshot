import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migrationsDir = join(process.cwd(), 'packages/db/migrations')
const journalPath = join(migrationsDir, 'meta/_journal.json')

describe('migration metadata', () => {
  it('tracks every SQL migration exactly once in the Drizzle journal', () => {
    const sqlTags = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort()

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ tag: string; idx: number }>
    }
    const journalTags = journal.entries.map((entry) => entry.tag).sort()

    expect(journalTags).toEqual(sqlTags)
  })

  it('uses sequential journal indexes for migration snapshots', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }

    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    )
    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(journal.entries.length)
  })

  it('has a snapshot for every journal entry', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number }>
    }

    for (const entry of journal.entries) {
      expect(
        existsSync(join(migrationsDir, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`)),
      ).toBe(true)
    }
  })

  it('keeps Drizzle snapshots in a linear chain', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number }>
    }
    const snapshots = journal.entries.map(
      (entry) =>
        JSON.parse(
          readFileSync(
            join(migrationsDir, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`),
            'utf8',
          ),
        ) as { id: string; prevId: string },
    )

    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(snapshots.length)
    expect(snapshots[0]?.prevId).toBe('00000000-0000-0000-0000-000000000000')
    for (let index = 1; index < snapshots.length; index += 1) {
      expect(snapshots[index].prevId).toBe(snapshots[index - 1].id)
    }
  })

  it('deduplicates existing suppressions before adding unique suppression indexes', () => {
    const migration = readFileSync(join(migrationsDir, '0009_cultured_killmonger.sql'), 'utf8')

    expect(migration).toContain("WHERE `scope` = 'global'")
    expect(migration).toContain('PARTITION BY `email`')
    expect(migration).toContain('ORDER BY datetime(`created_at`) ASC, rowid ASC')
    expect(migration).toContain("WHERE `scope` = 'product'")
    expect(migration).toContain('AND `product_id` IS NOT NULL')
    expect(migration).toContain('PARTITION BY `email`, `product_id`')
    expect(migration).toContain('product_id is required for product suppressions')
    expect(migration.indexOf('DELETE FROM `seq_suppressions`')).toBeLessThan(
      migration.indexOf('CREATE UNIQUE INDEX `idx_suppressions_global_unique`'),
    )
  })

  it('keeps suppression trigger migration executable as a whole file', () => {
    const migration = readFileSync(join(migrationsDir, '0009_cultured_killmonger.sql'), 'utf8')
    const db = createSuppressionsMigrationDb()

    db.exec(`
      INSERT INTO seq_suppressions (id, email, scope, product_id, reason, source, created_at)
      VALUES
        ('global_old', 'user@example.com', 'global', NULL, 'old', 'manual', '2026-01-01T00:00:00.000Z'),
        ('global_new', 'user@example.com', 'global', NULL, 'new', 'manual', '2026-02-01T00:00:00.000Z'),
        ('product_missing', 'missing@example.com', 'product', NULL, 'bad', 'manual', '2026-01-01T00:00:00.000Z'),
        ('product_old', 'tenant@example.com', 'product', 'prod_1', 'old', 'manual', '2026-01-01T00:00:00.000Z'),
        ('product_new', 'tenant@example.com', 'product', 'prod_1', 'new', 'manual', '2026-02-01T00:00:00.000Z')
    `)

    expect(migration).not.toContain('--> statement-breakpoint')
    runMigration(db, '0009_cultured_killmonger.sql')

    expect(db.prepare('SELECT id FROM seq_suppressions ORDER BY id').all()).toEqual([
      { id: 'global_old' },
      { id: 'product_old' },
    ])
    expect(() =>
      db.exec(`
      INSERT INTO seq_suppressions (id, email, scope, product_id, reason, source, created_at)
      VALUES ('invalid_product', 'bad@example.com', 'product', NULL, 'bad', 'manual', '2026-03-01T00:00:00.000Z')
    `),
    ).toThrow(/product_id is required/)

    db.close()
  })

  it('keeps the sequence run product update guard as one Wrangler migration statement', () => {
    const migration = readFileSync(
      join(migrationsDir, '0025_guard_sequence_run_product_scope.sql'),
      'utf8',
    )

    expect(migration.trimStart()).toMatch(/^-->\s*statement-breakpoint/)
    expect(
      migration
        .split('--> statement-breakpoint')
        .filter((statement) => statement.trim().length > 0),
    ).toHaveLength(1)
    expect(migration).toContain(
      'CREATE TRIGGER `seq_sequence_runs_require_product_id_after_update`',
    )
    expect(migration).toContain('product_id is required for sequence run updates')
  })

  it('exits running shutdown-product runs before deleting their sequence definitions', () => {
    const db = createShutdownProductsMigrationDb()
    db.exec(`
      INSERT INTO seq_sequence_runs (id, product_id, status, completed_at)
      VALUES
        ('retired_running', 'prod_skillledger', 'running', NULL),
        ('retired_completed', 'prod_skillledger', 'completed', '2026-06-01T00:00:00.000Z'),
        ('live_running', 'prod_camaudit', 'running', NULL);
      INSERT INTO seq_contact_products (id, product_id, status, unsubscribed_at, unsubscribe_scope, updated_at)
      VALUES
        ('retired_contact_product', 'prod_skillledger', 'active', NULL, NULL, '2026-06-01T00:00:00.000Z'),
        ('live_contact_product', 'prod_camaudit', 'active', NULL, NULL, '2026-06-01T00:00:00.000Z');
      INSERT INTO seq_lists (id, product_id)
      VALUES ('retired_list', 'prod_skillledger'), ('live_list', 'prod_camaudit');
      INSERT INTO seq_list_members (id, list_id, status, unsubscribed_at)
      VALUES
        ('retired_list_member', 'retired_list', 'subscribed', NULL),
        ('live_list_member', 'live_list', 'subscribed', NULL);
      INSERT INTO seq_suppressions (id, product_id, scope)
      VALUES
        ('retired_product_suppression', 'prod_skillledger', 'product'),
        ('retired_global_suppression', NULL, 'global'),
        ('live_product_suppression', 'prod_camaudit', 'product');
      INSERT INTO seq_instantly_campaigns (id, product_id, status)
      VALUES
        ('retired_campaign', 'prod_skillledger', 'active'),
        ('live_campaign', 'prod_camaudit', 'active');
      INSERT INTO seq_instantly_suppression_jobs (id, product, status, completed_at, updated_at)
      VALUES
        ('retired_pending_job', 'skillledger', 'pending', NULL, '2026-06-01T00:00:00.000Z'),
        ('retired_running_job', 'skillledger', 'running', NULL, '2026-06-01T00:00:00.000Z'),
        ('retired_succeeded_job', 'skillledger', 'succeeded', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
        ('live_pending_job', 'camaudit', 'pending', NULL, '2026-06-01T00:00:00.000Z');
      INSERT INTO seq_sequences (slug, product_id)
      VALUES
        ('skillledger-nurture-value-1', 'prod_skillledger'),
        ('camaudit-bookkeeper-cam-checklist', 'prod_camaudit');
      INSERT INTO seq_products (id)
      VALUES ('prod_skillledger'), ('prod_camaudit');
    `)

    runMigration(db, '0030_remove_shutdown_products.sql')

    expect(
      db
        .prepare('SELECT status, completed_at FROM seq_sequence_runs WHERE id = ?')
        .get('retired_running'),
    ).toEqual({ status: 'exited', completed_at: expect.any(String) })
    expect(
      db
        .prepare('SELECT status, completed_at FROM seq_sequence_runs WHERE id = ?')
        .get('retired_completed'),
    ).toEqual({ status: 'completed', completed_at: '2026-06-01T00:00:00.000Z' })
    expect(
      db
        .prepare('SELECT status, completed_at FROM seq_sequence_runs WHERE id = ?')
        .get('live_running'),
    ).toEqual({ status: 'running', completed_at: null })
    expect(db.prepare('SELECT slug FROM seq_sequences ORDER BY slug').all()).toEqual([
      { slug: 'camaudit-bookkeeper-cam-checklist' },
    ])
    expect(
      db
        .prepare(
          'SELECT status, unsubscribed_at, unsubscribe_scope FROM seq_contact_products WHERE id = ?',
        )
        .get('retired_contact_product'),
    ).toEqual({
      status: 'unsubscribed',
      unsubscribed_at: expect.any(String),
      unsubscribe_scope: 'product',
    })
    expect(
      db
        .prepare('SELECT status, unsubscribed_at FROM seq_list_members WHERE id = ?')
        .get('retired_list_member'),
    ).toBeUndefined()
    expect(
      db
        .prepare('SELECT status, unsubscribed_at FROM seq_list_members WHERE id = ?')
        .get('live_list_member'),
    ).toEqual({ status: 'subscribed', unsubscribed_at: null })
    expect(db.prepare('SELECT id FROM seq_lists ORDER BY id').all()).toEqual([{ id: 'live_list' }])
    expect(db.prepare('SELECT id FROM seq_suppressions ORDER BY id').all()).toEqual([
      { id: 'live_product_suppression' },
      { id: 'retired_global_suppression' },
    ])
    expect(
      db.prepare('SELECT status FROM seq_instantly_campaigns WHERE id = ?').get('retired_campaign'),
    ).toEqual({
      status: 'retired',
    })
    db.prepare("UPDATE seq_instantly_campaigns SET status = 'active' WHERE id = ?").run(
      'retired_campaign',
    )
    expect(
      db.prepare('SELECT status FROM seq_instantly_campaigns WHERE id = ?').get('retired_campaign'),
    ).toEqual({
      status: 'retired',
    })
    db.prepare("UPDATE seq_instantly_campaigns SET status = 'paused' WHERE id = ?").run(
      'live_campaign',
    )
    expect(
      db.prepare('SELECT status FROM seq_instantly_campaigns WHERE id = ?').get('live_campaign'),
    ).toEqual({
      status: 'paused',
    })
    expect(
      db
        .prepare('SELECT id, status, completed_at FROM seq_instantly_suppression_jobs ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'live_pending_job', status: 'pending', completed_at: null },
      { id: 'retired_pending_job', status: 'dead', completed_at: expect.any(String) },
      { id: 'retired_running_job', status: 'dead', completed_at: expect.any(String) },
      {
        id: 'retired_succeeded_job',
        status: 'succeeded',
        completed_at: '2026-06-01T00:00:00.000Z',
      },
    ])
    expect(db.prepare('SELECT id FROM seq_products ORDER BY id').all()).toEqual([
      { id: 'prod_camaudit' },
    ])
    db.close()
  })

  it('removes CapVeri and Lextract products while preserving live product rows', () => {
    const db = createShutdownProductsMigrationDb()
    db.exec(`
      INSERT INTO seq_sequence_runs (id, product_id, status, completed_at)
      VALUES
        ('retired_running', 'prod_capveri', 'running', NULL),
        ('retired_completed', 'prod_lextract', 'completed', '2026-06-01T00:00:00.000Z'),
        ('live_running', 'prod_camaudit', 'running', NULL);
      INSERT INTO seq_steps (id, run_id)
      VALUES
        ('retired_step', 'retired_running'),
        ('live_step', 'live_running');
      INSERT INTO seq_messages (id, step_id, product_id)
      VALUES
        ('retired_message', 'retired_step', 'prod_capveri'),
        ('live_message', 'live_step', 'prod_camaudit');
      INSERT INTO seq_contact_products (id, product_id, status, unsubscribed_at, unsubscribe_scope, updated_at)
      VALUES
        ('retired_contact_product', 'prod_lextract', 'active', NULL, NULL, '2026-06-01T00:00:00.000Z'),
        ('live_contact_product', 'prod_camaudit', 'active', NULL, NULL, '2026-06-01T00:00:00.000Z');
      INSERT INTO seq_contact_sources (id, product_id)
      VALUES ('retired_source', 'prod_capveri'), ('live_source', 'prod_camaudit');
      INSERT INTO seq_templates (slug, product_id)
      VALUES ('retired-template', 'prod_lextract'), ('live-template', 'prod_camaudit');
      INSERT INTO seq_lists (id, product_id)
      VALUES ('retired_list', 'prod_capveri'), ('live_list', 'prod_camaudit');
      INSERT INTO seq_list_members (id, list_id, status, unsubscribed_at)
      VALUES
        ('retired_list_member', 'retired_list', 'subscribed', NULL),
        ('live_list_member', 'live_list', 'subscribed', NULL);
      INSERT INTO seq_suppressions (id, product_id, scope)
      VALUES
        ('retired_product_suppression', 'prod_capveri', 'product'),
        ('retired_global_suppression', NULL, 'global'),
        ('live_product_suppression', 'prod_camaudit', 'product');
      INSERT INTO seq_instantly_campaigns (id, product_id, status)
      VALUES
        ('retired_campaign', 'prod_lextract', 'active'),
        ('live_campaign', 'prod_camaudit', 'active');
      INSERT INTO seq_instantly_campaign_daily_stats (id, campaign_id)
      VALUES
        ('retired_campaign_stats', 'retired_campaign'),
        ('live_campaign_stats', 'live_campaign');
      INSERT INTO seq_instantly_suppression_jobs (id, product, status, completed_at, updated_at)
      VALUES
        ('retired_pending_job', 'capveri', 'pending', NULL, '2026-06-01T00:00:00.000Z'),
        ('retired_running_job', 'lextract', 'running', NULL, '2026-06-01T00:00:00.000Z'),
        ('live_pending_job', 'camaudit', 'pending', NULL, '2026-06-01T00:00:00.000Z');
      INSERT INTO seq_sequences (slug, product_id)
      VALUES
        ('capveri-nurture-value-1', 'prod_capveri'),
        ('lextract-onboarding', 'prod_lextract'),
        ('camaudit-bookkeeper-cam-checklist', 'prod_camaudit');
      INSERT INTO seq_api_tokens (id, product_id)
      VALUES ('retired_token', 'prod_capveri'), ('live_token', 'prod_camaudit');
      INSERT INTO seq_lead_magnets (id, product_id)
      VALUES ('retired_magnet', 'prod_lextract'), ('live_magnet', 'prod_camaudit');
      INSERT INTO seq_products (id, firewall_partner_id, updated_at)
      VALUES
        ('prod_capveri', 'prod_camaudit', '2026-06-01T00:00:00.000Z'),
        ('prod_lextract', NULL, '2026-06-01T00:00:00.000Z'),
        ('prod_camaudit', 'prod_capveri', '2026-06-01T00:00:00.000Z');
    `)

    runMigration(db, '0031_remove_capveri_lextract.sql')

    expect(
      db
        .prepare('SELECT status, completed_at FROM seq_sequence_runs WHERE id = ?')
        .get('retired_running'),
    ).toBeUndefined()
    expect(
      db
        .prepare('SELECT status, completed_at FROM seq_sequence_runs WHERE id = ?')
        .get('live_running'),
    ).toEqual({ status: 'running', completed_at: null })
    expect(db.prepare('SELECT slug FROM seq_sequences ORDER BY slug').all()).toEqual([
      { slug: 'camaudit-bookkeeper-cam-checklist' },
    ])
    expect(db.prepare('SELECT id FROM seq_api_tokens ORDER BY id').all()).toEqual([
      { id: 'live_token' },
    ])
    expect(db.prepare('SELECT id FROM seq_lead_magnets ORDER BY id').all()).toEqual([
      { id: 'live_magnet' },
    ])
    expect(db.prepare('SELECT id FROM seq_contact_products ORDER BY id').all()).toEqual([
      { id: 'live_contact_product' },
    ])
    expect(db.prepare('SELECT id FROM seq_contact_sources ORDER BY id').all()).toEqual([
      { id: 'live_source' },
    ])
    expect(db.prepare('SELECT id FROM seq_messages ORDER BY id').all()).toEqual([
      { id: 'live_message' },
    ])
    expect(db.prepare('SELECT id FROM seq_steps ORDER BY id').all()).toEqual([{ id: 'live_step' }])
    expect(db.prepare('SELECT slug FROM seq_templates ORDER BY slug').all()).toEqual([
      { slug: 'live-template' },
    ])
    expect(db.prepare('SELECT id FROM seq_lists ORDER BY id').all()).toEqual([{ id: 'live_list' }])
    expect(db.prepare('SELECT id FROM seq_list_members ORDER BY id').all()).toEqual([
      { id: 'live_list_member' },
    ])
    expect(
      db.prepare('SELECT id FROM seq_instantly_campaign_daily_stats ORDER BY id').all(),
    ).toEqual([{ id: 'live_campaign_stats' }])
    expect(
      db.prepare('SELECT id, firewall_partner_id FROM seq_products ORDER BY id').all(),
    ).toEqual([{ id: 'prod_camaudit', firewall_partner_id: null }])
    expect(
      db.prepare('SELECT status FROM seq_instantly_campaigns WHERE id = ?').get('retired_campaign'),
    ).toBeUndefined()
    expect(db.prepare('SELECT id, status FROM seq_instantly_campaigns ORDER BY id').all()).toEqual([
      { id: 'live_campaign', status: 'active' },
    ])
    expect(
      db
        .prepare('SELECT id, status, completed_at FROM seq_instantly_suppression_jobs ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'live_pending_job', status: 'pending', completed_at: null },
      { id: 'retired_pending_job', status: 'dead', completed_at: expect.any(String) },
      { id: 'retired_running_job', status: 'dead', completed_at: expect.any(String) },
    ])
    db.close()
  })

  it('removes GrantPipe runtime state while preserving shared contacts and live products', () => {
    const db = createShutdownProductsMigrationDb()
    db.exec(`
      INSERT INTO seq_contacts (id) VALUES ('shared_contact');
      INSERT INTO seq_products (id, firewall_partner_id, updated_at)
      VALUES
        ('prod_grantpipe', NULL, '2026-07-13T00:00:00.000Z'),
        ('prod_camaudit', 'prod_grantpipe', '2026-07-13T00:00:00.000Z'),
        ('prod_floriva_web', NULL, '2026-07-13T00:00:00.000Z');
      INSERT INTO seq_sequences (slug, product_id)
      VALUES
        ('grantpipe-lead-magnet-nurture', 'prod_grantpipe'),
        ('camaudit-live', 'prod_camaudit'),
        ('floriva-live', 'prod_floriva_web');
      INSERT INTO seq_sequence_runs (id, product_id, status, completed_at)
      VALUES
        ('grantpipe_run', 'prod_grantpipe', 'running', NULL),
        ('camaudit_run', 'prod_camaudit', 'running', NULL);
      INSERT INTO seq_contact_products (id, product_id, status, updated_at)
      VALUES
        ('grantpipe_contact_product', 'prod_grantpipe', 'active', '2026-07-13T00:00:00.000Z'),
        ('camaudit_contact_product', 'prod_camaudit', 'active', '2026-07-13T00:00:00.000Z');
      INSERT INTO seq_api_tokens (id, product_id)
      VALUES ('grantpipe_token', 'prod_grantpipe'), ('camaudit_token', 'prod_camaudit');
      INSERT INTO seq_lead_magnets (id, product_id)
      VALUES ('grantpipe_magnet', 'prod_grantpipe'), ('floriva_magnet', 'prod_floriva_web');
    `)

    runMigration(db, '0032_remove_grantpipe.sql')

    expect(db.prepare('SELECT id FROM seq_contacts').all()).toEqual([{ id: 'shared_contact' }])
    expect(db.prepare('SELECT id FROM seq_products ORDER BY id').all()).toEqual([
      { id: 'prod_camaudit' },
      { id: 'prod_floriva_web' },
    ])
    expect(db.prepare('SELECT slug FROM seq_sequences ORDER BY slug').all()).toEqual([
      { slug: 'camaudit-live' },
      { slug: 'floriva-live' },
    ])
    expect(db.prepare('SELECT id FROM seq_sequence_runs ORDER BY id').all()).toEqual([
      { id: 'camaudit_run' },
    ])
    expect(db.prepare('SELECT id FROM seq_contact_products ORDER BY id').all()).toEqual([
      { id: 'camaudit_contact_product' },
    ])
    expect(db.prepare('SELECT id FROM seq_api_tokens ORDER BY id').all()).toEqual([
      { id: 'camaudit_token' },
    ])
    expect(db.prepare('SELECT id FROM seq_lead_magnets ORDER BY id').all()).toEqual([
      { id: 'floriva_magnet' },
    ])
    expect(
      db.prepare("SELECT firewall_partner_id FROM seq_products WHERE id = 'prod_camaudit'").get(),
    ).toEqual({ firewall_partner_id: null })
    db.close()
  })

  it('deduplicates provider webhook events before adding the webhook event unique index', () => {
    const migration = readFileSync(join(migrationsDir, '0011_unique_provider_events.sql'), 'utf8')

    expect(migration).toContain('DELETE FROM `seq_events`')
    expect(migration).toContain('PARTITION BY `provider`, `message_id`, `type`')
    expect(migration).toContain('WHERE `message_id` IS NOT NULL')
    expect(migration).toContain("`provider` IN ('resend', 'instantly')")
    expect(migration.indexOf('DELETE FROM `seq_events`')).toBeLessThan(
      migration.indexOf('CREATE UNIQUE INDEX `idx_events_provider_message_type_unique`'),
    )
  })

  it('deduplicates contact product memberships before adding the unique membership index', () => {
    const migration = readFileSync(join(migrationsDir, '0014_unique_contact_products.sql'), 'utf8')

    expect(migration).toContain('DELETE FROM `seq_contact_products`')
    expect(migration).toContain('PARTITION BY `contact_id`, `product_id`')
    expect(migration).toContain('ORDER BY')
    expect(migration).toContain('status_rank')
    expect(migration.indexOf('DELETE FROM `seq_contact_products`')).toBeLessThan(
      migration.indexOf('CREATE UNIQUE INDEX `idx_contact_products_contact_product_unique`'),
    )
  })

  it('keeps active contact product memberships over stale inactive duplicates', () => {
    const db = createContactProductsMigrationDb()
    db.exec(`
      INSERT INTO seq_contact_products (id, contact_id, product_id, status, created_at, updated_at)
      VALUES
        ('cp_old_unsubscribed', 'contact_1', 'prod_1', 'unsubscribed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('cp_new_active', 'contact_1', 'prod_1', 'active', '2026-05-01T00:00:00.000Z', '2026-05-20T00:00:00.000Z')
    `)

    runMigration(db, '0014_unique_contact_products.sql')

    expect(db.prepare('SELECT id, status FROM seq_contact_products').all()).toEqual([
      { id: 'cp_new_active', status: 'active' },
    ])
    db.close()
  })

  it('keeps the strongest inactive contact product membership when no active duplicate exists', () => {
    const db = createContactProductsMigrationDb()
    db.exec(`
      INSERT INTO seq_contact_products (id, contact_id, product_id, status, created_at, updated_at)
      VALUES
        ('cp_unsubscribed', 'contact_1', 'prod_1', 'unsubscribed', '2026-05-18T00:00:00.000Z', '2026-05-18T00:00:00.000Z'),
        ('cp_bounced', 'contact_1', 'prod_1', 'bounced', '2026-05-19T00:00:00.000Z', '2026-05-19T00:00:00.000Z'),
        ('cp_complained', 'contact_1', 'prod_1', 'complained', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')
    `)

    runMigration(db, '0014_unique_contact_products.sql')

    expect(db.prepare('SELECT id, status FROM seq_contact_products').all()).toEqual([
      { id: 'cp_complained', status: 'complained' },
    ])
    db.close()
  })

  it('backfills product-scoped contact profiles for single-product contacts only', () => {
    const db = createContactProductProfileMigrationDb()
    db.exec(`
      INSERT INTO seq_contacts (id, email, first_name, last_name, properties) VALUES
        ('contact_1', 'single@example.com', 'Uma', 'User', '{"plan":"trial"}'),
        ('contact_2', 'shared@example.com', 'Sam', 'Shared', '{"sensitive":"product-a"}');
      INSERT INTO seq_contact_products (id, contact_id, product_id, status, created_at, updated_at)
      VALUES
        ('cp_1', 'contact_1', 'prod_1', 'active', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
        ('cp_2a', 'contact_2', 'prod_1', 'active', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
        ('cp_2b', 'contact_2', 'prod_2', 'active', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    `)

    runMigration(db, '0015_contact_product_profiles.sql')

    expect(
      db
        .prepare(`
      SELECT first_name, last_name, properties FROM seq_contact_products WHERE id = 'cp_1'
    `)
        .get(),
    ).toEqual({
      first_name: 'Uma',
      last_name: 'User',
      properties: '{"plan":"trial"}',
    })
    expect(
      db
        .prepare(`
      SELECT id, first_name, last_name, properties FROM seq_contact_products WHERE contact_id = 'contact_2' ORDER BY id
    `)
        .all(),
    ).toEqual([
      { id: 'cp_2a', first_name: null, last_name: null, properties: null },
      { id: 'cp_2b', first_name: null, last_name: null, properties: null },
    ])
    db.close()
  })

  it('does not globally exit running runs in the deprecated 0006 migration', () => {
    const migration = readFileSync(
      join(migrationsDir, '0006_one_running_run_per_contact.sql'),
      'utf8',
    )

    expect(migration).toContain('Deprecated by 0016_product_scoped_sequence_runs')
    expect(migration).not.toContain('UPDATE seq_sequence_runs')
    expect(migration).not.toContain('CREATE UNIQUE INDEX `idx_runs_one_running_per_contact`')
  })

  it('moves Resend webhook dedupe to provider event ids without collapsing repeated message events', () => {
    const migration = readFileSync(join(migrationsDir, '0018_provider_event_ids.sql'), 'utf8')
    const db = createProviderEventIdMigrationDb()
    db.exec(`
      INSERT INTO seq_events (id, provider, message_id, type, payload, received_at)
      VALUES
        ('opened_1', 'resend', 'email_1', 'email.opened', '{}', '2026-05-01T00:00:00.000Z'),
        ('opened_2', 'resend', 'email_1', 'email.opened', '{}', '2026-05-01T00:01:00.000Z'),
        ('reply_1', 'instantly', 'reply_1', 'reply_received', '{}', '2026-05-01T00:02:00.000Z');
    `)

    expect(migration).toContain('provider_event_id')
    expect(migration).toContain('idx_events_provider_event_unique')
    expect(migration).toContain("`provider` = 'instantly'")
    runMigration(db, '0018_provider_event_ids.sql')

    expect(db.prepare('SELECT id FROM seq_events ORDER BY id').all()).toEqual([
      { id: 'opened_1' },
      { id: 'opened_2' },
      { id: 'reply_1' },
    ])
    expect(() =>
      db.exec(`
      INSERT INTO seq_events (id, provider, provider_event_id, message_id, type, payload, received_at)
      VALUES
        ('event_1', 'resend', 'evt_1', 'email_1', 'email.opened', '{}', '2026-05-01T00:03:00.000Z'),
        ('event_1_duplicate', 'resend', 'evt_1', 'email_1', 'email.opened', '{}', '2026-05-01T00:04:00.000Z')
    `),
    ).toThrow(/unique/i)
    expect(() =>
      db.exec(`
      INSERT INTO seq_events (id, provider, message_id, type, payload, received_at)
      VALUES
        ('reply_1_duplicate', 'instantly', 'reply_1', 'reply_received', '{}', '2026-05-01T00:05:00.000Z')
    `),
    ).toThrow(/unique/i)
    db.close()
  })

  it('tracks queue side-effect completion separately from raw event persistence', () => {
    const db = createProviderEventIdMigrationDb()

    runMigration(db, '0018_provider_event_ids.sql')
    runMigration(db, '0019_event_side_effect_completion.sql')
    runMigration(db, '0020_event_side_effect_leases.sql')

    expect(
      db
        .prepare(`
      SELECT name, type, "notnull" AS not_null
      FROM pragma_table_info('seq_events')
      WHERE name IN ('side_effects_started_at', 'side_effects_completed_at')
      ORDER BY name
    `)
        .all(),
    ).toEqual([
      {
        name: 'side_effects_completed_at',
        type: 'TEXT',
        not_null: 0,
      },
      {
        name: 'side_effects_started_at',
        type: 'TEXT',
        not_null: 0,
      },
    ])
    db.close()
  })

  it('adds async Resend failure and suppression tracking to messages', () => {
    const db = createStepMessageIdempotencyMigrationDb()

    runMigration(db, '0021_message_failure_tracking.sql')

    expect(
      db
        .prepare(`
      SELECT name, type, "notnull" AS not_null
      FROM pragma_table_info('seq_messages')
      WHERE name IN ('failed_at', 'failure_reason', 'suppressed_at')
      ORDER BY name
    `)
        .all(),
    ).toEqual([
      {
        name: 'failed_at',
        type: 'TEXT',
        not_null: 0,
      },
      {
        name: 'failure_reason',
        type: 'TEXT',
        not_null: 0,
      },
      {
        name: 'suppressed_at',
        type: 'TEXT',
        not_null: 0,
      },
    ])
    db.close()
  })

  it('adds product mapping to Instantly campaigns without rebuilding campaign state', () => {
    const migration = readFileSync(
      join(migrationsDir, '0022_instantly_campaign_product_mapping.sql'),
      'utf8',
    )
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE seq_instantly_campaigns (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at_instantly TEXT,
        synced_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO seq_instantly_campaigns (id, name, status)
      VALUES ('campaign_1', 'CAMAudit cold', 'active');
    `)

    expect(migration).toContain('ALTER TABLE `seq_instantly_campaigns` ADD `product_id` text')
    expect(migration).not.toContain('DROP TABLE')
    runMigration(db, '0022_instantly_campaign_product_mapping.sql')

    expect(
      db
        .prepare(`
      SELECT name, type, "notnull" AS not_null
      FROM pragma_table_info('seq_instantly_campaigns')
      WHERE name = 'product_id'
    `)
        .get(),
    ).toEqual({
      name: 'product_id',
      type: 'TEXT',
      not_null: 0,
    })
    expect(db.prepare('SELECT id, product_id FROM seq_instantly_campaigns').all()).toEqual([
      { id: 'campaign_1', product_id: null },
    ])
    db.close()
  })

  it('deduplicates Instantly daily stats before enforcing one row per campaign date', () => {
    const migration = readFileSync(
      join(migrationsDir, '0023_unique_instantly_campaign_daily_stats.sql'),
      'utf8',
    )
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE seq_instantly_campaign_daily_stats (
        id TEXT PRIMARY KEY NOT NULL,
        campaign_id TEXT NOT NULL,
        date TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        opened INTEGER NOT NULL DEFAULT 0,
        replied INTEGER NOT NULL DEFAULT 0,
        interested INTEGER NOT NULL DEFAULT 0,
        bounced INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_instantly_stats_campaign_date
        ON seq_instantly_campaign_daily_stats (campaign_id, date);
      INSERT INTO seq_instantly_campaign_daily_stats (id, campaign_id, date, sent, opened, replied, interested, bounced, synced_at)
      VALUES
        ('older', 'campaign_1', '2026-05-26', 1, 1, 0, 0, 0, '2026-05-26T10:00:00.000Z'),
        ('newer', 'campaign_1', '2026-05-26', 2, 2, 1, 1, 0, '2026-05-26T11:00:00.000Z');
    `)

    expect(migration).toContain('DELETE FROM seq_instantly_campaign_daily_stats')
    expect(migration).toContain('CREATE UNIQUE INDEX `idx_instantly_stats_campaign_date`')
    runMigration(db, '0023_unique_instantly_campaign_daily_stats.sql')

    expect(db.prepare('SELECT id FROM seq_instantly_campaign_daily_stats').all()).toEqual([
      { id: 'newer' },
    ])
    expect(() =>
      db.exec(`
      INSERT INTO seq_instantly_campaign_daily_stats (id, campaign_id, date)
      VALUES ('duplicate', 'campaign_1', '2026-05-26')
    `),
    ).toThrow(/unique/i)
    db.close()
  })

  it('adds D1-backed rate limit windows for atomic API throttling', () => {
    const migration = readFileSync(join(migrationsDir, '0024_rate_limit_windows.sql'), 'utf8')
    const db = new DatabaseSync(':memory:')

    expect(migration).toContain('CREATE TABLE `seq_rate_limit_windows`')
    expect(migration).toContain('CREATE INDEX `idx_rate_limit_windows_expires`')
    runMigration(db, '0024_rate_limit_windows.sql')

    db.exec(`
      INSERT INTO seq_rate_limit_windows (key, client_id, endpoint, window_start_ms, window_end_ms, count)
      VALUES ('rl:client:contacts:1', 'client.access', 'contacts', 1, 2, 999)
    `)
    db.exec(`
      UPDATE seq_rate_limit_windows
      SET count = count + 1
      WHERE key = 'rl:client:contacts:1' AND count < 1000
    `)
    db.exec(`
      UPDATE seq_rate_limit_windows
      SET count = count + 1
      WHERE key = 'rl:client:contacts:1' AND count < 1000
    `)

    expect(db.prepare('SELECT count FROM seq_rate_limit_windows').get()).toEqual({ count: 1000 })
    db.close()
  })

  it('backfills sequence run product ids and replaces the global active-run index without rebuilding the live table', () => {
    const migration = readFileSync(
      join(migrationsDir, '0016_product_scoped_sequence_runs.sql'),
      'utf8',
    )
    const db = createSequenceRunsProductMigrationDb()
    db.exec(`
      INSERT INTO seq_sequences (slug, product_id) VALUES
        ('camaudit-welcome', 'prod_camaudit'),
        ('grantpipe-welcome', 'prod_grantpipe');
      INSERT INTO seq_sequence_runs (id, contact_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES
        ('run_camaudit', 'contact_1', 'camaudit-welcome', 1, 'running', 0, '2026-05-01T00:00:00.000Z', 'api'),
        ('run_grantpipe', 'contact_1', 'grantpipe-welcome', 1, 'completed', 0, '2026-05-02T00:00:00.000Z', 'api');
    `)

    expect(migration).toContain('ALTER TABLE `seq_sequence_runs` ADD `product_id` text')
    expect(migration).not.toContain('DROP TABLE `seq_sequence_runs`')
    expect(migration).not.toContain('CREATE TABLE `seq_sequence_runs_new`')
    runMigration(db, '0016_product_scoped_sequence_runs.sql')

    expect(
      db
        .prepare(`
      SELECT COUNT(*) AS count FROM seq_sequence_runs WHERE product_id IS NULL
    `)
        .get(),
    ).toEqual({ count: 0 })
    expect(
      db
        .prepare(`
      SELECT "notnull" AS is_not_null FROM pragma_table_info('seq_sequence_runs') WHERE name = 'product_id'
    `)
        .get(),
    ).toEqual({ is_not_null: 0 })
    expect(
      db
        .prepare(`
      SELECT id, product_id FROM seq_sequence_runs ORDER BY id
    `)
        .all(),
    ).toEqual([
      { id: 'run_camaudit', product_id: 'prod_camaudit' },
      { id: 'run_grantpipe', product_id: 'prod_grantpipe' },
    ])
    expect(() =>
      db.exec(`
      INSERT INTO seq_sequence_runs (id, contact_id, product_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES
        ('run_camaudit_2', 'contact_1', 'prod_camaudit', 'camaudit-welcome', 1, 'running', 0, '2026-05-03T00:00:00.000Z', 'api')
    `),
    ).toThrow(/unique/i)
    expect(() =>
      db.exec(`
      INSERT INTO seq_sequence_runs (id, contact_id, product_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES
        ('run_grantpipe_2', 'contact_1', 'prod_grantpipe', 'grantpipe-welcome', 1, 'running', 0, '2026-05-03T00:00:00.000Z', 'api')
    `),
    ).not.toThrow()
    expect(() =>
      db.exec(`
      INSERT INTO seq_sequence_runs (id, contact_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES
        ('run_camaudit_legacy', 'contact_1', 'camaudit-welcome', 1, 'running', 0, '2026-05-04T00:00:00.000Z', 'api')
    `),
    ).toThrow(/unique/i)
    db.close()
  })

  it('preserves orphaned legacy runs as non-running records during product-scoped run migration', () => {
    const db = createSequenceRunsProductMigrationDb()
    db.exec(`
      INSERT INTO seq_sequence_runs (id, contact_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES ('run_orphaned', 'contact_1', 'deleted-sequence', 1, 'running', 0, '2026-05-01T00:00:00.000Z', 'api');
    `)

    runMigration(db, '0016_product_scoped_sequence_runs.sql')

    expect(
      db.prepare('SELECT id, product_id, status, completed_at FROM seq_sequence_runs').all(),
    ).toEqual([
      expect.objectContaining({
        id: 'run_orphaned',
        product_id: 'orphaned-sequence',
        status: 'errored',
      }),
    ])
    db.close()
  })

  it('rejects sequence run updates that would leave product scope null', () => {
    const db = createSequenceRunsProductMigrationDb()
    db.exec(`
      INSERT INTO seq_sequences (slug, product_id) VALUES
        ('camaudit-welcome', 'prod_camaudit');
      INSERT INTO seq_sequence_runs (id, contact_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES
        ('run_camaudit', 'contact_1', 'camaudit-welcome', 1, 'running', 0, '2026-05-01T00:00:00.000Z', 'api');
    `)

    runMigration(db, '0016_product_scoped_sequence_runs.sql')
    runMigration(db, '0025_guard_sequence_run_product_scope.sql')

    expect(
      db
        .prepare(`
      SELECT "notnull" AS is_not_null FROM pragma_table_info('seq_sequence_runs') WHERE name = 'product_id'
    `)
        .get(),
    ).toEqual({ is_not_null: 0 })
    expect(() =>
      db.exec(`
      UPDATE seq_sequence_runs SET product_id = NULL WHERE id = 'run_camaudit'
    `),
    ).toThrow(/product_id is required/)
    expect(
      db
        .prepare(`
      SELECT product_id, status FROM seq_sequence_runs WHERE id = 'run_camaudit'
    `)
        .get(),
    ).toEqual({ product_id: 'prod_camaudit', status: 'running' })
    db.close()
  })

  it('deduplicates legacy same-product running runs before creating the product-scoped index', () => {
    const db = createSequenceRunsProductMigrationDb()
    db.exec('DROP INDEX idx_runs_one_running_per_contact;')
    db.exec(`
      INSERT INTO seq_sequences (slug, product_id) VALUES
        ('camaudit-welcome', 'prod_camaudit'),
        ('camaudit-followup', 'prod_camaudit');
      INSERT INTO seq_sequence_runs (id, contact_id, sequence_slug, sequence_version, status, current_step_index, started_at, enrollment_source)
      VALUES
        ('run_first', 'contact_1', 'camaudit-welcome', 1, 'running', 0, '2026-05-01T00:00:00.000Z', 'api'),
        ('run_second', 'contact_1', 'camaudit-followup', 1, 'running', 0, '2026-05-02T00:00:00.000Z', 'api');
    `)

    runMigration(db, '0016_product_scoped_sequence_runs.sql')

    expect(
      db
        .prepare(`
      SELECT id, product_id, status, completed_at
      FROM seq_sequence_runs
      ORDER BY id
    `)
        .all(),
    ).toEqual([
      { id: 'run_first', product_id: 'prod_camaudit', status: 'running', completed_at: null },
      expect.objectContaining({
        id: 'run_second',
        product_id: 'prod_camaudit',
        status: 'exited',
      }),
    ])
    db.close()
  })

  it('records the expand-phase sequence run product scope in the Drizzle snapshot', () => {
    const snapshot = JSON.parse(
      readFileSync(join(migrationsDir, 'meta/0016_snapshot.json'), 'utf8'),
    ) as {
      tables: Record<
        string,
        {
          columns: Record<string, { notNull?: boolean }>
          indexes: Record<string, { columns: string[]; isUnique: boolean; where?: string }>
        }
      >
    }
    const sequenceRuns = snapshot.tables.seq_sequence_runs

    expect(sequenceRuns.columns.product_id).toBeDefined()
    expect(sequenceRuns.indexes.idx_runs_one_running_per_contact).toBeUndefined()
    expect(sequenceRuns.indexes.idx_runs_one_running_per_contact_product).toMatchObject({
      columns: ['contact_id', 'product_id'],
      isUnique: true,
    })
  })

  it('keeps historical snapshots aligned with the deprecated 0006 migration', () => {
    for (let idx = 7; idx <= 15; idx += 1) {
      const snapshot = JSON.parse(
        readFileSync(
          join(migrationsDir, `meta/${String(idx).padStart(4, '0')}_snapshot.json`),
          'utf8',
        ),
      ) as {
        tables: Record<string, { indexes: Record<string, unknown> }>
      }

      expect(
        snapshot.tables.seq_sequence_runs.indexes.idx_runs_one_running_per_contact,
      ).toBeUndefined()
    }
  })

  it('deduplicates step/message retry artifacts before adding idempotency indexes', () => {
    const db = createStepMessageIdempotencyMigrationDb()
    db.exec(`
      INSERT INTO seq_steps (id, run_id, step_index, scheduled_for, sent_at, message_id, template_slug, variant, status, error, created_at)
      VALUES
        ('step_pending', 'run_1', 0, '2026-05-01T00:00:00.000Z', NULL, 'msg_pending', 'template-a', NULL, 'pending', NULL, '2026-05-01T00:00:00.000Z'),
        ('step_sent', 'run_1', 0, '2026-05-01T00:00:00.000Z', '2026-05-01T00:01:00.000Z', 'msg_1', 'template-a', NULL, 'sent', NULL, '2026-05-01T00:02:00.000Z');
      INSERT INTO seq_messages (id, step_id, contact_id, product_id, resend_message_id, subject, from_email, sent_at, created_at)
      VALUES
        ('message_deleted_step', 'step_pending', 'contact_1', 'prod_1', 'resend_deleted_step', 'Subject', 'hello@example.com', '2026-05-01T00:00:30.000Z', '2026-05-01T00:00:30.000Z'),
        ('message_old', 'step_sent', 'contact_1', 'prod_1', 'resend_old', 'Subject', 'hello@example.com', '2026-05-01T00:01:00.000Z', '2026-05-01T00:01:00.000Z'),
        ('message_new', 'step_sent', 'contact_1', 'prod_1', 'resend_new', 'Subject', 'hello@example.com', '2026-05-01T00:02:00.000Z', '2026-05-01T00:02:00.000Z');
    `)

    runMigration(db, '0017_step_message_idempotency.sql')

    expect(db.prepare('SELECT id, status FROM seq_steps').all()).toEqual([
      { id: 'step_sent', status: 'sent' },
    ])
    expect(db.prepare('SELECT id, resend_message_id FROM seq_messages').all()).toEqual([
      { id: 'message_new', resend_message_id: 'resend_new' },
    ])
    expect(
      db
        .prepare(`
      SELECT m.id
      FROM seq_messages m
      LEFT JOIN seq_steps s ON s.id = m.step_id
      WHERE s.id IS NULL
    `)
        .all(),
    ).toEqual([])
    expect(() =>
      db.exec(`
      INSERT INTO seq_steps (id, run_id, step_index, scheduled_for, template_slug, status, created_at)
      VALUES ('step_duplicate', 'run_1', 0, '2026-05-01T00:00:00.000Z', 'template-a', 'pending', '2026-05-01T00:03:00.000Z')
    `),
    ).toThrow(/unique/i)
    expect(() =>
      db.exec(`
      INSERT INTO seq_messages (id, step_id, contact_id, product_id, subject, from_email, created_at)
      VALUES ('message_duplicate', 'step_sent', 'contact_1', 'prod_1', 'Subject', 'hello@example.com', '2026-05-01T00:03:00.000Z')
    `),
    ).toThrow(/unique/i)
    db.close()
  })

  it('records step/message idempotency indexes in the Drizzle snapshot', () => {
    const snapshot = JSON.parse(
      readFileSync(join(migrationsDir, 'meta/0017_snapshot.json'), 'utf8'),
    ) as {
      tables: Record<
        string,
        {
          indexes: Record<string, { columns: string[]; isUnique: boolean }>
        }
      >
    }

    expect(snapshot.tables.seq_steps.indexes.idx_steps_run_step_unique).toMatchObject({
      columns: ['run_id', 'step_index'],
      isUnique: true,
    })
    expect(snapshot.tables.seq_messages.indexes.idx_messages_step_unique).toMatchObject({
      columns: ['step_id'],
      isUnique: true,
    })
  })
})

function createContactProductsMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_contact_products (
      id text PRIMARY KEY,
      contact_id text NOT NULL,
      product_id text NOT NULL,
      status text NOT NULL,
      unsubscribed_at text,
      unsubscribe_scope text,
      notes text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    )
  `)
  return db
}

function createContactProductProfileMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_contacts (
      id text PRIMARY KEY,
      email text NOT NULL,
      first_name text,
      last_name text,
      properties text
    );
    CREATE TABLE seq_contact_products (
      id text PRIMARY KEY,
      contact_id text NOT NULL,
      product_id text NOT NULL,
      status text NOT NULL,
      unsubscribed_at text,
      unsubscribe_scope text,
      notes text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
  `)
  return db
}

function createSequenceRunsProductMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_sequences (
      slug text PRIMARY KEY,
      product_id text NOT NULL
    );
    CREATE TABLE seq_sequence_runs (
      id text PRIMARY KEY,
      contact_id text NOT NULL,
      sequence_slug text NOT NULL,
      sequence_version integer NOT NULL,
      status text NOT NULL,
      current_step_index integer DEFAULT 0 NOT NULL,
      started_at text NOT NULL
      ,
      completed_at text,
      variant_assignment text,
      enrollment_source text DEFAULT 'api' NOT NULL
    );
    CREATE UNIQUE INDEX idx_runs_one_running_per_contact
      ON seq_sequence_runs (contact_id)
      WHERE status = 'running';
    CREATE INDEX idx_runs_contact
      ON seq_sequence_runs (contact_id);
    CREATE INDEX idx_runs_sequence
      ON seq_sequence_runs (sequence_slug, status);
  `)
  return db
}

function createStepMessageIdempotencyMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_steps (
      id text PRIMARY KEY,
      run_id text NOT NULL,
      step_index integer NOT NULL,
      scheduled_for text NOT NULL,
      sent_at text,
      message_id text,
      template_slug text NOT NULL,
      variant text,
      status text NOT NULL,
      error text,
      created_at text NOT NULL
    );
    CREATE TABLE seq_messages (
      id text PRIMARY KEY,
      step_id text NOT NULL,
      contact_id text NOT NULL,
      product_id text NOT NULL,
      resend_message_id text,
      subject text NOT NULL,
      from_email text NOT NULL,
      html_r2_key text,
      sent_at text,
      delivered_at text,
      opened_at text,
      first_clicked_at text,
      replied_at text,
      bounced_at text,
      complained_at text,
      created_at text NOT NULL
    );
    CREATE INDEX idx_steps_run ON seq_steps (run_id, step_index);
    CREATE INDEX idx_messages_contact ON seq_messages (contact_id);
    CREATE INDEX idx_messages_resend_id ON seq_messages (resend_message_id);
  `)
  return db
}

function createProviderEventIdMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_events (
      id text PRIMARY KEY,
      provider text NOT NULL,
      message_id text,
      type text NOT NULL,
      payload text NOT NULL,
      received_at text NOT NULL
    );
    CREATE INDEX idx_events_message_id ON seq_events (message_id);
    CREATE UNIQUE INDEX idx_events_provider_message_type_unique
      ON seq_events (provider, message_id, type)
      WHERE message_id IS NOT NULL AND provider IN ('resend', 'instantly');
  `)
  db.exec('DROP INDEX idx_events_provider_message_type_unique')
  return db
}

function createSuppressionsMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_suppressions (
      id text PRIMARY KEY,
      email text NOT NULL,
      scope text NOT NULL,
      product_id text,
      reason text,
      source text,
      created_at text NOT NULL
    )
  `)
  return db
}

function createShutdownProductsMigrationDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_contacts (
      id text PRIMARY KEY
    );
    CREATE TABLE seq_api_tokens (
      id text PRIMARY KEY,
      product_id text NOT NULL
    );
    CREATE TABLE seq_lead_magnets (
      id text PRIMARY KEY,
      product_id text NOT NULL
    );
    CREATE TABLE seq_sequences (
      slug text PRIMARY KEY,
      product_id text NOT NULL
    );
    CREATE TABLE seq_products (
      id text PRIMARY KEY,
      firewall_partner_id text,
      updated_at text
    );
    CREATE TABLE seq_contact_sources (
      id text PRIMARY KEY,
      product_id text NOT NULL
    );
    CREATE TABLE seq_contact_products (
      id text PRIMARY KEY,
      product_id text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      unsubscribed_at text,
      unsubscribe_scope text,
      updated_at text
    );
    CREATE TABLE seq_lists (
      id text PRIMARY KEY,
      product_id text NOT NULL
    );
    CREATE TABLE seq_list_members (
      id text PRIMARY KEY,
      list_id text NOT NULL REFERENCES seq_lists(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'subscribed',
      unsubscribed_at text
    );
    CREATE TABLE seq_suppressions (
      id text PRIMARY KEY,
      product_id text,
      scope text NOT NULL
    );
    CREATE TABLE seq_instantly_campaigns (
      id text PRIMARY KEY,
      product_id text,
      status text NOT NULL DEFAULT 'active'
    );
    CREATE TABLE seq_instantly_campaign_daily_stats (
      id text PRIMARY KEY,
      campaign_id text NOT NULL
    );
    CREATE TABLE seq_instantly_suppression_jobs (
      id text PRIMARY KEY,
      product text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      last_error text,
      next_attempt_at text,
      locked_at text,
      completed_at text,
      updated_at text
    );
    CREATE TABLE seq_sequence_runs (
      id text PRIMARY KEY,
      product_id text,
      status text NOT NULL,
      completed_at text
    );
    CREATE TABLE seq_steps (
      id text PRIMARY KEY,
      run_id text NOT NULL
    );
    CREATE TABLE seq_messages (
      id text PRIMARY KEY,
      step_id text,
      product_id text NOT NULL
    );
    CREATE TABLE seq_templates (
      slug text PRIMARY KEY,
      product_id text NOT NULL
    );
  `)
  return db
}

function runMigration(db: DatabaseSync, migrationName: string): void {
  const migration = readFileSync(join(migrationsDir, migrationName), 'utf8')
  for (const statement of migration.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql.length > 0) {
      db.exec(sql)
    }
  }
}
