import { contacts, createDb, sequence_runs } from '@sequencer/db'
import { and, eq } from 'drizzle-orm'
import type { Env } from '../types'
import { createLogger } from './observability'

type CancelSuppressedRunsOptions = {
  contactId?: string | null
  email?: string | null
  productId?: string | null
  reason: string
}

export async function cancelActiveRunsForSuppression(
  env: Env,
  options: CancelSuppressedRunsOptions,
): Promise<number> {
  const db = createDb(env.DB)
  const logger = createLogger(env, { source: 'run_control' })
  const reason = `suppression:${options.reason}`
  const runs = await findActiveRuns(db, options)

  for (const run of runs) {
    if (typeof run.id !== 'string') continue
    await cancelSequenceRunDO(env, run.id, reason, logger)
  }

  return runs.length
}

async function findActiveRuns(
  db: ReturnType<typeof createDb>,
  options: CancelSuppressedRunsOptions,
): Promise<Array<{ id: string }>> {
  if (options.contactId) {
    if (options.productId) {
      return db
        .select({ id: sequence_runs.id })
        .from(sequence_runs)
        .where(
          and(
            eq(sequence_runs.contact_id, options.contactId),
            eq(sequence_runs.product_id, options.productId),
            eq(sequence_runs.status, 'running'),
          ),
        )
        .limit(100)
    }

    return db
      .select({ id: sequence_runs.id })
      .from(sequence_runs)
      .where(
        and(eq(sequence_runs.contact_id, options.contactId), eq(sequence_runs.status, 'running')),
      )
      .limit(100)
  }

  const email = options.email?.trim().toLowerCase()
  if (!email) return []

  if (options.productId) {
    return db
      .select({ id: sequence_runs.id })
      .from(sequence_runs)
      .innerJoin(contacts, eq(sequence_runs.contact_id, contacts.id))
      .where(
        and(
          eq(contacts.email, email),
          eq(sequence_runs.product_id, options.productId),
          eq(sequence_runs.status, 'running'),
        ),
      )
      .limit(100)
  }

  return db
    .select({ id: sequence_runs.id })
    .from(sequence_runs)
    .innerJoin(contacts, eq(sequence_runs.contact_id, contacts.id))
    .where(and(eq(contacts.email, email), eq(sequence_runs.status, 'running')))
    .limit(100)
}

async function cancelSequenceRunDO(
  env: Env,
  runId: string,
  reason: string,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  try {
    const doId = env.SEQUENCE_RUN.idFromName(runId)
    const stub = env.SEQUENCE_RUN.get(doId)
    const response = await stub.fetch(
      new Request('https://do/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    )
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '')
      throw new Error(`DO suppression cancellation failed with ${response.status}: ${responseBody}`)
    }
  } catch (err) {
    logger.warn('Failed to cancel suppressed run', { run_id: runId, error: (err as Error).message })
    throw err
  }
}
