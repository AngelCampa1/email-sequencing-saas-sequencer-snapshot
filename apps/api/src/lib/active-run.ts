import type { createDb } from '@sequencer/db'
import { sequence_runs } from '@sequencer/db'
import { and, asc, eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export interface ActiveSequenceRun {
  id: string
  contact_id: string
  product_id: string
  sequence_slug: string
  status: 'running'
  started_at: string
}

export async function findRunningRunForContact(
  db: Db,
  contactId: string,
  productId: string,
): Promise<ActiveSequenceRun | null> {
  const [run] = await db
    .select({
      id: sequence_runs.id,
      contact_id: sequence_runs.contact_id,
      product_id: sequence_runs.product_id,
      sequence_slug: sequence_runs.sequence_slug,
      status: sequence_runs.status,
      started_at: sequence_runs.started_at,
    })
    .from(sequence_runs)
    .where(
      and(
        eq(sequence_runs.contact_id, contactId),
        eq(sequence_runs.product_id, productId),
        eq(sequence_runs.status, 'running'),
      ),
    )
    .orderBy(asc(sequence_runs.started_at))
    .limit(1)

  return run as ActiveSequenceRun | null
}

export function isRunningRunUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('unique') &&
    (message.includes('idx_runs_one_running_per_contact_product') ||
      message.includes('idx_runs_one_running_per_contact') ||
      (message.includes('seq_sequence_runs.contact_id') &&
        message.includes('seq_sequence_runs.product_id')) ||
      message.includes('sequence_runs.contact_id'))
  )
}
