import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processDueInstantlySuppressionJobs } from '../lib/instantly-suppression-jobs'

const markConvertedSignup = vi.fn()

vi.mock('../providers/instantly', () => ({
  createInstantlyAdapter: vi.fn(() => ({ markConvertedSignup })),
}))

function createD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE seq_instantly_suppression_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      job_key TEXT NOT NULL,
      email TEXT NOT NULL,
      product TEXT NOT NULL,
      event_type TEXT NOT NULL,
      properties TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 8,
      last_error TEXT,
      result TEXT,
      next_attempt_at TEXT,
      locked_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const d1 = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      let params: unknown[] = []
      return {
        bind(...values: unknown[]) {
          params = values
          return this
        },
        all() {
          return { results: statement.all(...params) }
        },
        first() {
          return statement.get(...params) ?? null
        },
        run() {
          const result = statement.run(...params) as { changes?: number }
          return { meta: { changes: result.changes ?? 0 } }
        },
      }
    },
  }

  return { sqlite, d1 }
}

describe('Instantly suppression jobs', () => {
  let db: ReturnType<typeof createD1>

  beforeEach(() => {
    db = createD1()
    vi.clearAllMocks()
  })

  afterEach(() => {
    db.sqlite.close()
  })

  it('marks a due signup suppression job succeeded after Instantly confirms the move', async () => {
    markConvertedSignup.mockResolvedValueOnce({ leadsUpdated: 1, moveJobsStarted: 1 })
    db.sqlite.exec(`
      INSERT INTO seq_instantly_suppression_jobs
        (id, job_key, email, product, event_type, properties, status, attempts, max_attempts, next_attempt_at)
      VALUES
        ('job_1', 'api:client:signup_completed:camaudit:user:user_1', 'lead@example.com', 'camaudit',
         'signup_completed', '{"ve_campaign_id":"cam-1"}', 'pending', 0, 8, '2026-06-11T00:00:00.000Z')
    `)

    await expect(
      processDueInstantlySuppressionJobs({ DB: db.d1 } as never, { limit: 10 }),
    ).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 })

    expect(markConvertedSignup).toHaveBeenCalledWith({
      email: 'lead@example.com',
      product: 'camaudit',
      event: 'signup_completed',
      properties: { ve_campaign_id: 'cam-1' },
    })
    expect(
      db.sqlite
        .prepare(
          'SELECT status, attempts, last_error, completed_at FROM seq_instantly_suppression_jobs',
        )
        .get(),
    ).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      last_error: null,
    })
  })

  it('dead-letters a job instead of dropping it after the final retry fails', async () => {
    markConvertedSignup.mockRejectedValueOnce(new Error('Instantly 500'))
    db.sqlite.exec(`
      INSERT INTO seq_instantly_suppression_jobs
        (id, job_key, email, product, event_type, status, attempts, max_attempts, next_attempt_at)
      VALUES
        ('job_2', 'api:client:signup_completed:grantpipe:user:user_2', 'ops@example.com', 'grantpipe',
         'signup_completed', 'failed', 7, 8, '2026-06-11T00:00:00.000Z')
    `)

    await expect(
      processDueInstantlySuppressionJobs({ DB: db.d1 } as never, { limit: 10 }),
    ).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 })

    expect(
      db.sqlite
        .prepare(
          'SELECT status, attempts, last_error, next_attempt_at FROM seq_instantly_suppression_jobs',
        )
        .get(),
    ).toEqual({
      status: 'dead',
      attempts: 8,
      last_error: 'Instantly 500',
      next_attempt_at: null,
    })
  })
})
