import type { Env } from '../types'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  sequence_slug?: string
  run_id?: string
  step_id?: string
  product?: string
  contact_id_hash?: string
  [key: string]: unknown
}

export function createLogger(env: Env, baseCtx: LogContext = {}) {
  const gitSha = env.GIT_SHA ?? 'local'

  function log(level: LogLevel, message: string, ctx: LogContext = {}) {
    const entry = {
      level,
      message,
      git_sha: gitSha,
      environment: env.ENVIRONMENT,
      ...baseCtx,
      ...ctx,
      ts: new Date().toISOString(),
    }
    if (level === 'error') {
      console.error(JSON.stringify(entry))
    } else {
      console.log(JSON.stringify(entry))
    }
  }

  return {
    debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
    info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
    warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
    error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
  }
}

// Analytics Engine helpers
export type MetricEvent =
  | {
      name: 'send.attempted'
      dims: { product: string; sequence: string; step: string; variant: string }
    }
  | {
      name: 'send.sent'
      dims: { product: string; sequence: string; step: string; variant: string }
    }
  | {
      name: 'send.skipped'
      dims: { product: string; sequence: string; step: string; reason: string }
    }
  | {
      name: 'send.failed'
      dims: { product: string; sequence: string; step: string; error: string }
    }
  | {
      name: 'dead_letter.failed'
      dims: { product: string; sequence: string; step: string; error: string }
    }
  | { name: 'webhook.received'; dims: { provider: string; event_type: string } }
  | { name: 'enrollment.created'; dims: { product: string; sequence: string; source: string } }
  | { name: 'suppression.applied'; dims: { scope: string; product: string } }

export function trackMetric(analytics: AnalyticsEngineDataset, event: MetricEvent) {
  analytics.writeDataPoint({
    blobs: [event.name, ...Object.values(event.dims)],
    indexes: [event.name],
  })
}
