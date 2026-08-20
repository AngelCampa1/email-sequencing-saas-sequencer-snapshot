import { withD1Retry } from '../lib/d1-retry'
import { createLogger } from '../lib/observability'
import type { Env } from '../types'

export async function handleCron(cron: string, env: Env): Promise<void> {
  const logger = createLogger(env, { source: 'cron' })
  logger.info('Cron triggered', { cron })

  switch (cron) {
    case '0 * * * *': // Hourly: Instantly stats sync
      await runInstantlySync(env)
      await runInstantlySuppressionRetry(env)
      break
    case '0 3 * * *': // Daily 03:00: domain health rollup
      await runDomainHealthRollup(env)
      break
    case '30 3 * * *': // Daily 03:30: rot detector
      await runRotDetector(env)
      break
    case '0 4 * * *': // Daily 04:00: D1 JSON backup artifact to R2
      await runD1Backup(env)
      break
    default:
      logger.warn('Unknown cron schedule', { cron })
  }
}

async function runInstantlySuppressionRetry(env: Env): Promise<void> {
  const logger = createLogger(env, { cron: 'instantly_suppression_retry' })
  const { processDueInstantlySuppressionJobs } = await import('../lib/instantly-suppression-jobs')
  const result = await processDueInstantlySuppressionJobs(env, { limit: 25 })
  logger.info('Instantly suppression retry complete', result)
}

// Instantly sync
async function runInstantlySync(env: Env): Promise<void> {
  const logger = createLogger(env, { cron: 'instantly_sync' })

  if (!env.INSTANTLY_API_KEY) {
    logger.info('INSTANTLY_API_KEY not set, skipping sync')
    return
  }

  const { createInstantlyAdapter } = await import('../providers/instantly')
  const { createDb, instantly_campaigns, instantly_campaign_daily_stats } = await import(
    '@sequencer/db'
  )
  const { eq } = await import('drizzle-orm')

  const adapter = createInstantlyAdapter(env)!
  const db = createDb(env.DB)

  // D1 occasionally returns a transient "storage caused object to be reset"
  // error mid-cron; retry those so a single blip doesn't fail the whole sync.
  const onD1Retry = (error: unknown, attempt: number) =>
    logger.warn('Transient D1 error during Instantly sync; retrying', {
      attempt,
      error: error instanceof Error ? error.message : String(error),
    })
  const retryD1 = <T>(op: () => Promise<T>): Promise<T> => withD1Retry(op, { onRetry: onD1Retry })

  const campaigns = await adapter.listCampaigns()
  logger.info('Instantly campaigns fetched', { count: campaigns.length })

  let statsFailures = 0
  for (const campaign of campaigns) {
    // Upsert campaign record
    const existing = await retryD1(() =>
      db
        .select({ id: instantly_campaigns.id, status: instantly_campaigns.status })
        .from(instantly_campaigns)
        .where(eq(instantly_campaigns.id, campaign.id))
        .limit(1),
    )

    if (existing.length === 0) {
      // onConflictDoNothing keeps the insert idempotent: if a transient D1 reset
      // is retried after the row already committed, the retry is a no-op instead
      // of a fatal UNIQUE violation that would defeat the retry.
      await retryD1(() =>
        db
          .insert(instantly_campaigns)
          .values({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status ?? 'active',
            created_at_instantly: campaign.created_at,
          })
          .onConflictDoNothing(),
      )
    } else {
      const isRetiredCampaign = existing[0]?.status === 'retired'
      await retryD1(() =>
        db
          .update(instantly_campaigns)
          .set({
            name: campaign.name,
            status: isRetiredCampaign ? 'retired' : (campaign.status ?? 'active'),
            synced_at: new Date().toISOString(),
          })
          .where(eq(instantly_campaigns.id, campaign.id)),
      )
      if (isRetiredCampaign) continue
    }

    const today = new Date().toISOString().slice(0, 10)
    let stats: Awaited<ReturnType<typeof adapter.getCampaignAnalytics>>
    try {
      stats = await adapter.getCampaignAnalytics(campaign.id, today)
    } catch (error) {
      statsFailures++
      logger.warn('Instantly campaign analytics sync failed; skipping campaign stats', {
        campaign_id: campaign.id,
        date: today,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (stats) {
      await retryD1(() =>
        db
          .insert(instantly_campaign_daily_stats)
          .values({
            campaign_id: campaign.id,
            date: today,
            sent: stats.sent,
            opened: stats.opened,
            replied: stats.replied,
            interested: stats.interested,
            bounced: stats.bounced,
          })
          .onConflictDoUpdate({
            target: [
              instantly_campaign_daily_stats.campaign_id,
              instantly_campaign_daily_stats.date,
            ],
            set: {
              sent: stats.sent,
              opened: stats.opened,
              replied: stats.replied,
              interested: stats.interested,
              bounced: stats.bounced,
              synced_at: new Date().toISOString(),
            },
          }),
      )
    }
  }

  logger.info('Instantly sync complete', {
    campaigns: campaigns.length,
    stats_failures: statsFailures,
  })
}

// Domain health rollup
async function runDomainHealthRollup(env: Env): Promise<void> {
  const logger = createLogger(env, { cron: 'domain_health' })

  const today = new Date().toISOString().slice(0, 10)
  const windowStart = new Date(Date.parse(`${today}T00:00:00.000Z`) - 6 * 86400_000)
    .toISOString()
    .slice(0, 10)
  const tomorrow = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86400_000)
    .toISOString()
    .slice(0, 10)

  const { results } = await env.DB.prepare(`
    SELECT
      sent_date AS date,
      sending_domain AS domain,
      count(*) AS sent,
      sum(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
      sum(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
      sum(CASE WHEN first_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
      sum(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
      sum(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complained
    FROM (
      SELECT
        substr(sent_at, 1, 10) AS sent_date,
        lower(substr(from_email, instr(from_email, '@') + 1)) AS sending_domain,
        delivered_at,
        opened_at,
        first_clicked_at,
        bounced_at,
        complained_at
      FROM seq_messages
      WHERE sent_at >= ? AND sent_at < ?
    )
    GROUP BY sent_date, sending_domain
  `)
    .bind(windowStart, tomorrow)
    .all<{
      date: string
      domain: string
      sent: number
      delivered: number
      opened: number
      clicked: number
      bounced: number
      complained: number
    }>()

  for (const row of results ?? []) {
    if (!row.domain) continue
    const existing = await env.DB.prepare(
      'SELECT id FROM seq_domain_health WHERE domain = ? AND date = ? LIMIT 1',
    )
      .bind(row.domain, row.date)
      .first<{ id: string }>()

    if (existing?.id) {
      await env.DB.prepare(`
        UPDATE seq_domain_health
        SET sent = ?, delivered = ?, opened = ?, clicked = ?, bounced = ?, complained = ?
        WHERE id = ?
      `)
        .bind(
          row.sent,
          row.delivered,
          row.opened,
          row.clicked,
          row.bounced,
          row.complained,
          existing.id,
        )
        .run()
    } else {
      await env.DB.prepare(`
        INSERT INTO seq_domain_health (id, domain, date, sent, delivered, opened, clicked, bounced, complained)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          crypto.randomUUID(),
          row.domain,
          row.date,
          row.sent,
          row.delivered,
          row.opened,
          row.clicked,
          row.bounced,
          row.complained,
        )
        .run()
    }
  }

  logger.info('Domain health rollup complete', { domains: results?.length ?? 0 })
}

// Rot detector
async function runRotDetector(env: Env): Promise<void> {
  const logger = createLogger(env, { cron: 'rot_detector' })
  const { createDb, sequences, sequence_runs } = await import('@sequencer/db')
  const { eq, and, gte, count } = await import('drizzle-orm')
  const db = createDb(env.DB)

  // "Rot" = an active sequence with ZERO enrollments in the last 90 days.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString()
  const activeSeqs = await db.select().from(sequences).where(eq(sequences.is_active, true))

  let rotCount = 0
  for (const seq of activeSeqs) {
    const [result] = await db
      .select({ total: count() })
      .from(sequence_runs)
      .where(
        and(
          eq(sequence_runs.sequence_slug, seq.slug),
          gte(sequence_runs.started_at, ninetyDaysAgo),
        ),
      )

    if ((result?.total ?? 0) === 0) {
      rotCount++
      logger.info('Rot detected', { sequence: seq.slug, product: seq.product_id })
    }
  }

  logger.info('Rot detector complete', { active_sequences: activeSeqs.length, rot_count: rotCount })
}

// D1 backup
async function runD1Backup(env: Env): Promise<void> {
  const logger = createLogger(env, { cron: 'd1_backup' })
  const createdAt = new Date().toISOString()
  const rootKey = `backups/d1/${createdAt}`
  const { results } = await env.DB.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name GLOB 'seq_*'
    ORDER BY name ASC
  `).all<{ name: string }>()

  const tables: Record<
    string,
    {
      count: number
      chunks: Array<{ key: string; count: number; offset: number }>
    }
  > = {}
  for (const row of results ?? []) {
    const tableName = normalizeBackupTableName(row.name)
    if (!tableName) {
      logger.warn('Skipping unexpected D1 backup table name', { table: row.name })
      continue
    }
    tables[tableName] = await writeTableBackupChunks(env, logger, rootKey, createdAt, tableName)
  }

  const backup = JSON.stringify({
    schema_version: 1,
    created_at: createdAt,
    completed_at: new Date().toISOString(),
    source: 'sequencer-db',
    consistency: 'best_effort_non_transactional',
    tables,
  })
  const options = { httpMetadata: { contentType: 'application/json' } }
  const key = `${rootKey}/manifest.json`

  await putBackupArtifact(env, logger, key, backup, options)
  await putBackupArtifact(env, logger, 'backups/d1/latest.json', backup, options)
  logger.info('D1 backup artifact written', { key, tables: Object.keys(tables).length })
}

const BACKUP_TABLE_NAME_RE = /^seq_[A-Za-z0-9_]+$/

function normalizeBackupTableName(name: string): string | null {
  if (!BACKUP_TABLE_NAME_RE.test(name)) {
    return null
  }
  return name
}

const BACKUP_PAGE_SIZE = 500

async function writeTableBackupChunks(
  env: Env,
  logger: ReturnType<typeof createLogger>,
  rootKey: string,
  createdAt: string,
  tableName: string,
): Promise<{ count: number; chunks: Array<{ key: string; count: number; offset: number }> }> {
  const chunks: Array<{ key: string; count: number; offset: number }> = []
  let count = 0
  let offset = 0
  let page = 1

  while (true) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM \`${tableName}\` ORDER BY rowid ASC LIMIT ? OFFSET ?`,
    )
      .bind(BACKUP_PAGE_SIZE, offset)
      .all()
    const rows = results ?? []
    if (rows.length === 0) break

    const key = `${rootKey}/${tableName}/${page.toString().padStart(6, '0')}.json`
    await putBackupArtifact(
      env,
      logger,
      key,
      JSON.stringify({
        schema_version: 1,
        created_at: createdAt,
        table: tableName,
        offset,
        count: rows.length,
        rows,
      }),
      { httpMetadata: { contentType: 'application/json' } },
    )
    chunks.push({ key, count: rows.length, offset })
    count += rows.length

    if (rows.length < BACKUP_PAGE_SIZE) break
    offset += BACKUP_PAGE_SIZE
    page++
  }

  return { count, chunks }
}

const BACKUP_R2_PUT_ATTEMPTS = 3
const BACKUP_R2_RETRY_DELAYS_MS = [100, 500]

async function putBackupArtifact(
  env: Env,
  logger: ReturnType<typeof createLogger>,
  key: string,
  value: string,
  options: Parameters<Env['LOGS_BUCKET']['put']>[2],
): Promise<void> {
  for (let attempt = 1; attempt <= BACKUP_R2_PUT_ATTEMPTS; attempt++) {
    try {
      await env.LOGS_BUCKET.put(key, value, options)
      return
    } catch (err) {
      if (attempt === BACKUP_R2_PUT_ATTEMPTS || !isRetryableR2PutError(err)) {
        throw err
      }

      logger.warn('Transient R2 backup artifact write failed; retrying', {
        key,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      })
      await sleep(BACKUP_R2_RETRY_DELAYS_MS[attempt - 1] ?? 500)
    }
  }
}

function isRetryableR2PutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\b(10001|internal error|please try again|temporar(?:y|ily)|timeout|timed out)\b/i.test(
    message,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
