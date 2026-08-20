import { createDb, instantly_suppression_jobs } from '@sequencer/db'
import { eq, sql } from 'drizzle-orm'
import { createInstantlyAdapter } from '../providers/instantly'
import type { Env } from '../types'
import { createLogger } from './observability'

const MAX_ATTEMPTS = 8
const ERROR_PREVIEW_LIMIT = 500
const DEFAULT_PROCESS_LIMIT = 10

type SuppressionJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead'

export interface SuppressionJobInput {
  key: string
  email: string
  product: string
  event: string
  properties?: Record<string, unknown>
}

interface SuppressionJobRow {
  id: string
  job_key: string
  email: string
  product: string
  event_type: string
  properties: string | Record<string, unknown> | null
  status: SuppressionJobStatus
  attempts: number
  max_attempts: number
}

export async function enqueueInstantlySuppressionJob(
  env: Env,
  input: SuppressionJobInput,
): Promise<void> {
  const db = createDb(env.DB)
  await db
    .insert(instantly_suppression_jobs)
    .values({
      job_key: input.key,
      email: input.email.trim().toLowerCase(),
      product: input.product,
      event_type: input.event,
      properties: input.properties ?? {},
      max_attempts: MAX_ATTEMPTS,
      next_attempt_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: instantly_suppression_jobs.job_key,
      set: {
        email: input.email.trim().toLowerCase(),
        product: input.product,
        event_type: input.event,
        properties: input.properties ?? {},
        updated_at: new Date().toISOString(),
      },
      where: sql`${instantly_suppression_jobs.status} NOT IN ('succeeded', 'dead')`,
    })
}

export async function processDueInstantlySuppressionJobs(
  env: Env,
  options: { limit?: number } = {},
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = options.limit ?? DEFAULT_PROCESS_LIMIT
  const now = new Date().toISOString()
  const rows = await env.DB.prepare(
    `
      SELECT id, job_key, email, product, event_type, properties, status, attempts, max_attempts
      FROM seq_instantly_suppression_jobs
      WHERE status IN ('pending', 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?
    `,
  )
    .bind(now, limit)
    .all<SuppressionJobRow>()

  let processed = 0
  let succeeded = 0
  let failed = 0

  for (const row of rows.results ?? []) {
    processed++
    const result = await processInstantlySuppressionJob(env, row)
    if (result === 'succeeded') succeeded++
    if (result === 'failed') failed++
  }

  return { processed, succeeded, failed }
}

export async function processInstantlySuppressionJobByKey(
  env: Env,
  jobKey: string,
): Promise<'missing' | 'succeeded' | 'failed' | 'skipped'> {
  const row = await env.DB.prepare(
    `
      SELECT id, job_key, email, product, event_type, properties, status, attempts, max_attempts
      FROM seq_instantly_suppression_jobs
      WHERE job_key = ?
      LIMIT 1
    `,
  )
    .bind(jobKey)
    .first<SuppressionJobRow>()
  if (!row) return 'missing'
  if (row.status === 'succeeded' || row.status === 'dead') return 'skipped'
  return processInstantlySuppressionJob(env, row)
}

async function processInstantlySuppressionJob(
  env: Env,
  row: SuppressionJobRow,
): Promise<'succeeded' | 'failed' | 'skipped'> {
  const logger = createLogger(env, { source: 'instantly_suppression_job' })
  const now = new Date().toISOString()
  const claimed = await env.DB.prepare(
    `
      UPDATE seq_instantly_suppression_jobs
      SET status = 'running',
          attempts = attempts + 1,
          locked_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'failed')
    `,
  )
    .bind(now, now, row.id)
    .run()

  if ((claimed.meta.changes ?? 0) === 0) return 'skipped'

  const nextAttempt = row.attempts + 1
  try {
    const adapter = createInstantlyAdapter(env)
    if (!adapter) throw new Error('INSTANTLY_API_KEY is not configured')
    const result = await adapter.markConvertedSignup({
      email: row.email,
      product: row.product,
      event: row.event_type,
      properties: parseProperties(row.properties),
    })
    await env.DB.prepare(
      `
        UPDATE seq_instantly_suppression_jobs
        SET status = 'succeeded',
            result = ?,
            last_error = NULL,
            locked_at = NULL,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(JSON.stringify(result), now, now, row.id)
      .run()
    logger.info('Instantly suppression job succeeded', {
      job_key: row.job_key,
      email: row.email,
      product: row.product,
      leads_updated: result.leadsUpdated,
      move_jobs_started: result.moveJobsStarted,
    })
    return 'succeeded'
  } catch (err) {
    const message = truncateError((err as Error).message)
    const dead = nextAttempt >= row.max_attempts
    const nextAttemptAt = dead ? null : retryAt(nextAttempt)
    await env.DB.prepare(
      `
        UPDATE seq_instantly_suppression_jobs
        SET status = ?,
            last_error = ?,
            next_attempt_at = ?,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(dead ? 'dead' : 'failed', message, nextAttemptAt, now, row.id)
      .run()
    logger.warn('Instantly suppression job failed', {
      job_key: row.job_key,
      email: row.email,
      product: row.product,
      attempts: nextAttempt,
      max_attempts: row.max_attempts,
      dead,
      error: message,
    })
    return 'failed'
  }
}

function parseProperties(value: SuppressionJobRow['properties']): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  }
  return value
}

function retryAt(attempt: number): string {
  const delayMinutes = Math.min(240, 2 ** Math.max(0, attempt - 1))
  return new Date(Date.now() + delayMinutes * 60_000).toISOString()
}

function truncateError(message: string): string {
  return message.length > ERROR_PREVIEW_LIMIT
    ? `${message.slice(0, ERROR_PREVIEW_LIMIT - 3)}...`
    : message
}
