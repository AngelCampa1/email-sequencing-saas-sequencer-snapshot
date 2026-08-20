import { audit_log, createDb } from '@sequencer/db'
import type { Env } from '../types'

export async function audit(
  env: Env,
  actor: string,
  action: string,
  targetType: string,
  targetId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  const db = createDb(env.DB)
  await db.insert(audit_log).values({
    actor,
    action,
    target_type: targetType,
    target_id: targetId,
    before: before as any,
    after: after as any,
  })
}
