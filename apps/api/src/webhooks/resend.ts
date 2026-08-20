import { Hono } from 'hono'
import { createLogger, trackMetric } from '../lib/observability'
import type { Env } from '../types'

export const resendWebhookRoute = new Hono<{ Bindings: Env }>()

resendWebhookRoute.post('/', async (c) => {
  const logger = createLogger(c.env, { source: 'resend_webhook' })

  // Verify Resend HMAC signature
  const signature = c.req.header('svix-signature') ?? c.req.header('resend-signature')
  const timestamp = c.req.header('svix-timestamp') ?? c.req.header('resend-timestamp')
  const msgId = c.req.header('svix-id') ?? c.req.header('resend-id')

  const rawBody = await c.req.text()

  if (!c.env.RESEND_WEBHOOK_SECRET) {
    logger.error('Resend webhook: RESEND_WEBHOOK_SECRET not configured')
    return c.json({ error: 'Webhook verification not configured' }, 500)
  }
  if (!signature || !timestamp || !msgId) {
    logger.warn('Resend webhook: missing signature headers')
    return c.json({ error: 'Missing signature headers' }, 401)
  }

  // Replay protection: reject timestamps older than 5 minutes
  if (!/^\d+$/.test(timestamp)) {
    logger.warn('Resend webhook: timestamp out of range', { timestamp })
    return c.json({ error: 'Timestamp out of range' }, 401)
  }
  const tsSeconds = parseInt(timestamp, 10)
  if (!Number.isFinite(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
    logger.warn('Resend webhook: timestamp out of range', { timestamp })
    return c.json({ error: 'Timestamp out of range' }, 401)
  }

  const isValid = await verifyResendSignature(
    rawBody,
    signature,
    timestamp,
    msgId,
    c.env.RESEND_WEBHOOK_SECRET,
  )
  if (!isValid) {
    logger.warn('Resend webhook: invalid signature')
    return c.json({ error: 'Invalid signature' }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  if (!isRecord(payload)) {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  const eventType = typeof payload.type === 'string' ? payload.type : 'unknown'
  const data = isRecord(payload.data) ? payload.data : null
  const messageId = typeof data?.email_id === 'string' ? data.email_id : null

  // Publish to queue for async processing
  await c.env.EVENTS_QUEUE.send({
    provider: 'resend',
    event_id: msgId,
    event_type: eventType,
    message_id: messageId,
    payload,
    received_at: new Date().toISOString(),
  })

  trackMetric(c.env.ANALYTICS, {
    name: 'webhook.received',
    dims: { provider: 'resend', event_type: eventType },
  })

  logger.info('Resend webhook queued', { event_type: eventType, msg_id: msgId })
  return c.json({ ok: true }, 200)
})

async function verifyResendSignature(
  body: string,
  signature: string,
  timestamp: string,
  msgId: string,
  secret: string,
): Promise<boolean> {
  try {
    // Svix signature format: "v1,<base64_sig>"
    // Signed content: "{msg_id}.{timestamp}.{body}"
    const signedContent = `${msgId}.${timestamp}.${body}`
    const secretBytes = base64ToUint8Array(secret.replace('whsec_', ''))

    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    // Extract v1 signatures
    const sigs = signature.split(' ')
    for (const sig of sigs) {
      if (!sig.startsWith('v1,')) continue
      const sigBytes = base64ToUint8Array(sig.slice(3))
      const msgBytes = new TextEncoder().encode(signedContent)
      const valid = await crypto.subtle.verify(
        'HMAC',
        key,
        sigBytes.buffer as ArrayBuffer,
        msgBytes.buffer as ArrayBuffer,
      )
      if (valid) return true
    }
    return false
  } catch {
    return false
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
