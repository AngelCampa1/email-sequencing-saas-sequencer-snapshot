import { Hono } from 'hono'
import { createLogger, trackMetric } from '../lib/observability'
import type { Env } from '../types'

export const instantlyWebhookRoute = new Hono<{ Bindings: Env }>()

instantlyWebhookRoute.post('/', async (c) => {
  const logger = createLogger(c.env, { source: 'instantly_webhook' })

  // Shared-secret check. Instantly doesn't sign webhooks like Resend, so we
  // gate by a header secret provisioned in both Instantly and Wrangler.
  const expected = c.env.INSTANTLY_WEBHOOK_SECRET
  if (!expected) {
    logger.error('Instantly webhook: INSTANTLY_WEBHOOK_SECRET not configured')
    return c.json({ error: 'Webhook verification not configured' }, 500)
  }
  const provided =
    c.req.header('x-instantly-webhook-secret') ??
    c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!provided || !constantTimeEqual(provided, expected)) {
    logger.warn('Instantly webhook: invalid secret')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const rawBody = await c.req.text()

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  if (!isRecord(payload)) {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  const payloadData = isRecord(payload.data) ? payload.data : null
  const eventType =
    typeof payload.event_type === 'string'
      ? payload.event_type
      : typeof payload.type === 'string'
        ? payload.type
        : typeof payloadData?.event_type === 'string'
          ? payloadData.event_type
          : typeof payloadData?.type === 'string'
            ? payloadData.type
            : 'unknown'
  const messageId = extractMessageId(payload)
  const eventId = extractEventId(payload, eventType)
  const receivedAt = new Date().toISOString()

  trackMetric(c.env.ANALYTICS, {
    name: 'webhook.received',
    dims: { provider: 'instantly', event_type: eventType },
  })

  await c.env.EVENTS_QUEUE.send({
    provider: 'instantly',
    event_id: eventId,
    event_type: eventType,
    message_id: messageId,
    payload,
    received_at: receivedAt,
  })

  logger.info('Instantly webhook received', { event_type: eventType })
  return c.json({ ok: true }, 200)
})

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function extractMessageId(payload: Record<string, unknown>): string | null {
  const nested = isRecord(payload.data) ? extractMessageId(payload.data) : null
  if (nested) return nested
  const direct = payload.message_id ?? payload.email_id ?? payload.id
  return typeof direct === 'string' ? direct : null
}

function extractEventId(payload: Record<string, unknown>, eventType: string): string | null {
  const nested = isRecord(payload.data) ? extractEventId(payload.data, eventType) : null
  if (nested) return nested

  const direct = payload.event_id ?? payload.webhook_event_id
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()

  const campaignId = stringField(payload.campaign_id)
  const timestamp = stringField(payload.timestamp)
  const email = normalizeEmail(stringField(payload.lead_email) ?? stringField(payload.email))
  if (!campaignId || !timestamp || !email) return null
  return `instantly:${eventType}:${campaignId}:${email}:${timestamp}`
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function normalizeEmail(value: string | null): string | null {
  return value ? value.toLowerCase() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
