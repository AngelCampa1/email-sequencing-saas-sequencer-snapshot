import type { Env } from '../types'

const RATE_LIMITS = {
  default: { requests: 1000, windowSeconds: 3600 }, // 1000/hour per token
  'auth-fail': { requests: 30, windowSeconds: 300 }, // 30/5min per failed client auth key
  'lead-magnets': { requests: 5000, windowSeconds: 3600 }, // higher for lead magnet downloads
}

export async function rateLimitMiddleware(
  env: Env,
  clientId: string,
  endpoint: string,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const limit = RATE_LIMITS[endpoint as keyof typeof RATE_LIMITS] ?? RATE_LIMITS.default
  const windowMs = limit.windowSeconds * 1000
  const now = Date.now()
  const windowStart = Math.floor(now / windowMs) * windowMs
  const windowEnd = windowStart + windowMs
  const kvKey = `rl:${clientId}:${endpoint}:${windowStart}`
  const nowIso = new Date(now).toISOString()

  await env.DB.prepare(`
    INSERT OR IGNORE INTO seq_rate_limit_windows (key, client_id, endpoint, window_start_ms, window_end_ms, count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `)
    .bind(kvKey, clientId, endpoint, windowStart, windowEnd, nowIso, nowIso)
    .run()

  const incrementResult = await env.DB.prepare(`
    UPDATE seq_rate_limit_windows
    SET count = count + 1, updated_at = ?
    WHERE key = ? AND count < ?
  `)
    .bind(nowIso, kvKey, limit.requests)
    .run()

  const countRow = await env.DB.prepare(`
    SELECT count FROM seq_rate_limit_windows WHERE key = ?
  `)
    .bind(kvKey)
    .first<{ count: number | string | null }>()
  const count = normalizeCount(countRow?.count)
  const allowed = writeChangedRows(incrementResult)

  if (!allowed) {
    return { allowed: false, remaining: 0, resetAt: windowEnd }
  }

  return { allowed: true, remaining: Math.max(0, limit.requests - count), resetAt: windowEnd }
}

function normalizeCount(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function writeChangedRows(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true
  const record = result as { meta?: { changes?: unknown }; changes?: unknown }
  if (typeof record.meta?.changes === 'number') return record.meta.changes > 0
  if (typeof record.changes === 'number') return record.changes > 0
  return true
}
