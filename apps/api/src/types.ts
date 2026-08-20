export interface Env {
  ENVIRONMENT: string
  GIT_SHA?: string
  SENTRY_DSN?: string

  // D1
  DB: D1Database

  // KV
  SUPPRESSIONS: KVNamespace
  SESSIONS: KVNamespace

  // R2
  ASSETS_BUCKET: R2Bucket
  LOGS_BUCKET: R2Bucket
  CAMAUDIT_ASSETS?: R2Bucket
  FLORIVA_LEAD_MAGNETS?: R2Bucket

  // Queues
  EVENTS_QUEUE: Queue
  DEAD_LETTER_QUEUE: Queue

  // Analytics Engine
  ANALYTICS: AnalyticsEngineDataset

  // Durable Objects
  SEQUENCE_RUN: DurableObjectNamespace

  // Secrets
  RESEND_API_KEY_CAMAUDIT?: string
  RESEND_API_KEY_FLORIVA_WEB?: string
  RESEND_WEBHOOK_SECRET?: string
  INSTANTLY_API_KEY?: string
  INSTANTLY_CONVERTED_SIGNUPS_LIST_ID?: string
  INSTANTLY_WEBHOOK_SECRET?: string
  UNSUBSCRIBE_SIGNING_SECRET?: string
  CF_ACCESS_TEAM_NAME?: string
  CF_ACCESS_AUD?: string
}
