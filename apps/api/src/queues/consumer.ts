import {
  contacts,
  createDb,
  events,
  instantly_campaigns,
  messages,
  products,
  sequence_runs,
} from '@sequencer/db'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { createLogger, trackMetric } from '../lib/observability'
import { cancelActiveRunsForSuppression } from '../lib/run-control'
import { addSuppression } from '../lib/suppression'
import type { Env } from '../types'

const EVENT_SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000

interface QueueMessage {
  provider: 'resend' | 'instantly'
  event_id?: string | null
  event_type: string
  message_id: string | null
  payload: unknown
  received_at?: string
}

export async function queueConsumer(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const logger = createLogger(env, { source: 'queue_consumer' })
  const db = createDb(env.DB)

  for (const msg of batch.messages) {
    if (!isQueueMessage(msg.body)) {
      logger.warn('Malformed queue message body')
      msg.ack()
      continue
    }

    const { provider, event_id, event_type, message_id, payload } = msg.body
    let leaseStartedAt: string | null = null

    try {
      const receivedAt = normalizeQueueReceivedAt(msg.body.received_at)
      if (event_id) {
        const [existingEvent] = await db
          .select({
            id: events.id,
            type: events.type,
            message_id: events.message_id,
            payload: events.payload,
            sideEffectsStartedAt: events.side_effects_started_at,
            sideEffectsCompletedAt: events.side_effects_completed_at,
          })
          .from(events)
          .where(and(eq(events.provider, provider), eq(events.provider_event_id, event_id)))
          .limit(1)
        if (
          queueEventConflicts(
            existingEvent,
            { provider, event_id, event_type, message_id },
            payload,
          )
        ) {
          logger.error('Conflicting provider event id skipped', { provider, event_id, event_type })
          msg.ack()
          continue
        }
        if (eventSideEffectsCompleted(existingEvent)) {
          logger.info('Duplicate provider event skipped', { provider, event_id, event_type })
          msg.ack()
          continue
        }
      }
      if (!event_id && provider === 'instantly' && message_id) {
        const [existingEvent] = await db
          .select({
            id: events.id,
            type: events.type,
            message_id: events.message_id,
            payload: events.payload,
            sideEffectsStartedAt: events.side_effects_started_at,
            sideEffectsCompletedAt: events.side_effects_completed_at,
          })
          .from(events)
          .where(
            and(
              eq(events.provider, provider),
              eq(events.message_id, message_id),
              eq(events.type, event_type),
            ),
          )
          .limit(1)
        if (eventSideEffectsCompleted(existingEvent)) {
          logger.info('Duplicate Instantly event skipped', { provider, message_id, event_type })
          msg.ack()
          continue
        }
      }

      // 1. Persist raw event to D1
      const insertResult = await db
        .insert(events)
        .values({
          provider,
          provider_event_id: event_id ?? null,
          message_id,
          type: event_type,
          payload: payload as Record<string, unknown>,
          received_at: receivedAt,
        })
        .onConflictDoNothing()
      if (insertWasConflictNoop(insertResult)) {
        const existingEvent = await findExistingQueueEvent(db, {
          provider,
          event_id,
          event_type,
          message_id,
        })
        if (
          queueEventConflicts(
            existingEvent,
            { provider, event_id, event_type, message_id },
            payload,
          )
        ) {
          logger.error('Conflicting queue event identity skipped after insert conflict', {
            provider,
            event_id,
            message_id,
            event_type,
          })
          msg.ack()
          continue
        }
        if (eventSideEffectsCompleted(existingEvent)) {
          logger.info('Duplicate queue event skipped after insert conflict', {
            provider,
            event_id,
            message_id,
            event_type,
          })
          msg.ack()
          continue
        }
      }

      const claim = await claimQueueEventSideEffects(db, {
        provider,
        event_id,
        event_type,
        message_id,
      })
      if (claim === 'completed') {
        logger.info('Duplicate queue event skipped after completion', {
          provider,
          event_id,
          message_id,
          event_type,
        })
        msg.ack()
        continue
      }
      if (claim === 'busy') {
        logger.info('Duplicate queue event side effects already in progress', {
          provider,
          event_id,
          message_id,
          event_type,
        })
        msg.retry()
        continue
      }
      leaseStartedAt = claim.leaseStartedAt

      // 2. Handle specific event types
      if (provider === 'resend') {
        await handleResendEvent(env, event_type, message_id, payload, receivedAt, db, logger)
      } else if (provider === 'instantly') {
        await handleInstantlyEvent(env, event_type, payload, receivedAt, db, logger)
      }

      const completed = await markQueueEventSideEffectsCompleted(
        db,
        { provider, event_id, event_type, message_id },
        leaseStartedAt,
      )
      if (!completed) {
        const existingEvent = await findExistingQueueEvent(db, {
          provider,
          event_id,
          event_type,
          message_id,
        })
        if (eventSideEffectsCompleted(existingEvent)) {
          logger.info('Queue event side effects completed by another worker', {
            provider,
            event_id,
            message_id,
            event_type,
          })
          msg.ack()
          continue
        }
        throw new Error('Queue event side-effect completion lease was lost')
      }
      msg.ack()
    } catch (err) {
      await releaseQueueEventSideEffectsClaim(
        db,
        { provider, event_id, event_type, message_id },
        leaseStartedAt,
      )
      logger.error('Queue consumer error', { error: (err as Error).message, event_type, provider })
      msg.retry()
    }
  }
}

function isQueueMessage(value: unknown): value is QueueMessage {
  if (!isRecord(value)) return false
  const provider = value.provider
  return (
    (provider === 'resend' || provider === 'instantly') &&
    typeof value.event_type === 'string' &&
    (typeof value.event_id === 'string' ||
      value.event_id === null ||
      value.event_id === undefined) &&
    (typeof value.message_id === 'string' || value.message_id === null) &&
    Object.hasOwn(value, 'payload') &&
    value.payload !== undefined &&
    (typeof value.received_at === 'string' || value.received_at === undefined)
  )
}

function normalizeQueueReceivedAt(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      const canonicalInput = value.includes('.') ? value : value.replace('Z', '.000Z')
      const canonicalParsed = parsed.toISOString()
      if (canonicalParsed === canonicalInput) return canonicalParsed
    }
  }
  return new Date().toISOString()
}

async function handleResendEvent(
  env: Env,
  eventType: string,
  messageId: string | null,
  payload: unknown,
  receivedAt: string,
  db: ReturnType<typeof createDb>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const payloadRecord = isRecord(payload) ? payload : {}
  const data = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord
  const resendEmailId = typeof data.email_id === 'string' ? data.email_id : messageId
  const payloadEmail = extractResendEmail(data)
  let messageContext: ResendMessageContext | null | undefined

  const getMessageContext = async (): Promise<ResendMessageContext | null> => {
    if (messageContext !== undefined) return messageContext
    if (!resendEmailId) {
      messageContext = null
      return messageContext
    }
    messageContext = await resolveResendMessageContext(db, resendEmailId)
    return messageContext
  }

  switch (eventType) {
    case 'email.delivered': {
      if (!resendEmailId) return
      const result = await db
        .update(messages)
        .set({ delivered_at: receivedAt })
        .where(eq(messages.resend_message_id, resendEmailId))
      await ensureResendMessageMutationApplied(db, resendEmailId, result)
      logger.info('Resend: email delivered', { email_id: resendEmailId })
      break
    }
    case 'email.opened': {
      if (!resendEmailId) return
      const result = await db
        .update(messages)
        .set({ opened_at: receivedAt })
        .where(eq(messages.resend_message_id, resendEmailId))
      await ensureResendMessageMutationApplied(db, resendEmailId, result)
      break
    }
    case 'email.clicked': {
      if (!resendEmailId) return
      const result = await db
        .update(messages)
        .set({ first_clicked_at: receivedAt })
        .where(
          and(eq(messages.resend_message_id, resendEmailId), isNull(messages.first_clicked_at)),
        )
      await ensureResendMessageMutationApplied(db, resendEmailId, result)
      break
    }
    case 'email.bounced': {
      if (!resendEmailId) return
      const result = await db
        .update(messages)
        .set({ bounced_at: receivedAt })
        .where(eq(messages.resend_message_id, resendEmailId))
      await ensureResendMessageMutationApplied(db, resendEmailId, result)

      const context = await getMessageContext()
      const toEmail = payloadEmail ?? context?.contact_email ?? null
      if (toEmail) {
        await addSuppression(env, toEmail, 'global', null, 'hard_bounce', 'bounce')
        await cancelActiveRunsForSuppression(env, {
          contactId: contactIdForSuppressedEmail(payloadEmail, context),
          email: toEmail,
          reason: 'hard_bounce',
        })
        logger.info('Bounce suppression added', { email: toEmail })
      }
      break
    }
    case 'email.complained': {
      if (!resendEmailId) return
      const result = await db
        .update(messages)
        .set({ complained_at: receivedAt })
        .where(eq(messages.resend_message_id, resendEmailId))
      await ensureResendMessageMutationApplied(db, resendEmailId, result)

      const context = await getMessageContext()
      const toEmail = payloadEmail ?? context?.contact_email ?? null
      if (toEmail) {
        await addSuppression(env, toEmail, 'global', null, 'spam_complaint', 'complaint')
        await cancelActiveRunsForSuppression(env, {
          contactId: contactIdForSuppressedEmail(payloadEmail, context),
          email: toEmail,
          reason: 'spam_complaint',
        })
        logger.info('Complaint suppression added', { email: toEmail })
      }
      break
    }
    case 'email.suppressed': {
      if (!resendEmailId) return
      const result = await db
        .update(messages)
        .set({ suppressed_at: receivedAt })
        .where(eq(messages.resend_message_id, resendEmailId))
      await ensureResendMessageMutationApplied(db, resendEmailId, result)

      const context = await getMessageContext()
      const toEmail = payloadEmail ?? context?.contact_email ?? null
      if (toEmail) {
        await addSuppression(env, toEmail, 'global', null, 'provider_suppressed', 'suppression')
        await cancelActiveRunsForSuppression(env, {
          contactId: contactIdForSuppressedEmail(payloadEmail, context),
          email: toEmail,
          reason: 'provider_suppressed',
        })
        logger.info('Provider suppression added', { email: toEmail })
      }
      break
    }
    case 'email.failed': {
      if (!resendEmailId) return
      const updated = await markResendMessageFailed(
        env.DB,
        resendEmailId,
        receivedAt,
        extractResendFailureReason(data),
      )
      if (!updated) {
        await ensureResendMessageMutationApplied(db, resendEmailId, { meta: { changes: 0 } })
      }
      logger.warn('Resend async send failed', { email_id: resendEmailId })
      break
    }
    case 'email.received':
    case 'email.replied': {
      await handleResendReplyEvent(env, data, receivedAt, db, logger)
      break
    }
    case 'contact.updated': {
      const toEmail = payloadEmail
      if (toEmail && data.unsubscribed === true) {
        await addSuppression(env, toEmail, 'global', null, 'unsubscribed', 'webhook')
        await cancelActiveRunsForSuppression(env, {
          email: toEmail,
          reason: 'unsubscribed',
        })
        logger.info('Contact unsubscribe suppression added', { email: toEmail })
      }
      break
    }
    case 'email.unsubscribed': {
      const toEmail = payloadEmail ?? (await getMessageContext())?.contact_email ?? null
      if (toEmail) {
        // Get product from the tags in payload
        const tags = extractResendTags(data.tags)
        const productSlug = getResendTagValue(tags, 'product')

        let productId = (await getMessageContext())?.product_id ?? null
        if (!productId && productSlug) {
          const [p] = await db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.slug, productSlug))
            .limit(1)
          productId = p?.id ?? null
        }

        if (productId) {
          await addSuppression(env, toEmail, 'product', productId, 'unsubscribed', 'webhook')
          logger.info('Unsubscribe suppression added', {
            email: toEmail,
            product: productSlug ?? undefined,
          })
        } else {
          logger.warn('Resend unsubscribe missing known product tag; skipping suppression', {
            email: toEmail,
            product: productSlug ?? undefined,
          })
        }

        // Prefer product-wide active run fanout when message context is available,
        // even if the provider included a single run tag.
        const context = await getMessageContext()
        if (context?.contact_id && productId) {
          await notifyActiveProductRunsByIds(
            env,
            db,
            context.contact_id,
            productId,
            'unsubscribed',
            logger,
          )
        } else if (productId) {
          await cancelActiveRunsForSuppression(env, {
            email: toEmail,
            productId,
            reason: 'unsubscribed',
          })
        }
      }
      break
    }
    default:
      logger.info('Resend unhandled event type', { event_type: eventType })
  }
}

type ResendMessageContext = {
  contact_id: string | null
  contact_email: string | null
  product_id: string | null
}

function contactIdForSuppressedEmail(
  payloadEmail: string | null,
  context: ResendMessageContext | null,
): string | null {
  if (!context?.contact_id) return null
  if (!payloadEmail) return context.contact_id
  return payloadEmail === context.contact_email ? context.contact_id : null
}

function extractResendFailureReason(data: Record<string, unknown>): string {
  const failure = isRecord(data.failed) ? data.failed : isRecord(data.error) ? data.error : null
  const reason = failure && typeof failure.reason === 'string' ? failure.reason.trim() : ''
  const message = failure && typeof failure.message === 'string' ? failure.message.trim() : ''
  const fallback = typeof data.reason === 'string' ? data.reason.trim() : ''
  const parts = [reason || fallback, message].filter(Boolean)
  return parts.length > 0 ? parts.join(': ').slice(0, 1000) : 'resend_send_failed'
}

async function resolveResendMessageContext(
  db: ReturnType<typeof createDb>,
  resendEmailId: string,
): Promise<ResendMessageContext | null> {
  const [message] = await db
    .select({
      contact_id: contacts.id,
      contact_email: contacts.email,
      product_id: messages.product_id,
    })
    .from(messages)
    .innerJoin(contacts, eq(messages.contact_id, contacts.id))
    .where(eq(messages.resend_message_id, resendEmailId))
    .limit(1)

  return message
    ? {
        contact_id: typeof message.contact_id === 'string' ? message.contact_id : null,
        contact_email:
          typeof message.contact_email === 'string' ? message.contact_email.toLowerCase() : null,
        product_id: typeof message.product_id === 'string' ? message.product_id : null,
      }
    : null
}

async function ensureResendMessageMutationApplied(
  db: ReturnType<typeof createDb>,
  resendEmailId: string,
  result: unknown,
): Promise<void> {
  if (writeSucceededOrUnknown(result)) return
  if (await resendMessageExists(db, resendEmailId)) return
  throw new Error(`Resend message row not found for webhook: ${resendEmailId}`)
}

async function resendMessageExists(
  db: ReturnType<typeof createDb>,
  resendEmailId: string,
): Promise<boolean> {
  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.resend_message_id, resendEmailId))
    .limit(1)
  return Boolean(message)
}

async function handleInstantlyEvent(
  env: Env,
  eventType: string,
  payload: unknown,
  receivedAt: string,
  db: ReturnType<typeof createDb>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const payloadRecord = isRecord(payload) ? payload : {}
  const data = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord
  const email = extractReplyEmail(data)
  const campaignProductId = await resolveInstantlyCampaignProductId(db, data)

  if (eventType === 'lead_unsubscribed') {
    if (!email) return
    if (!campaignProductId) {
      throw new Error('Instantly unsubscribe missing campaign product ownership')
    }
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, email))
      .limit(1)
    await addSuppression(
      env,
      email,
      'product',
      campaignProductId,
      'unsubscribed',
      'instantly_webhook',
    )
    await cancelActiveRunsForSuppression(env, {
      contactId: typeof contact?.id === 'string' ? contact.id : null,
      email,
      productId: campaignProductId,
      reason: 'unsubscribed',
    })
    return
  }

  if (eventType === 'email_bounced') {
    if (!email) return
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, email))
      .limit(1)
    await addSuppression(env, email, 'global', null, 'hard_bounce', 'instantly_webhook')
    await cancelActiveRunsForSuppression(env, {
      contactId: typeof contact?.id === 'string' ? contact.id : null,
      email,
      reason: 'hard_bounce',
    })
    return
  }

  if (eventType !== 'reply_received') return

  const runId = extractRunId(data)
  if (runId) {
    if (extractInstantlyCampaignId(data) && !campaignProductId) {
      throw new Error('Instantly reply missing campaign product ownership')
    }
    const verified = await directRunMatchesProviderEvent(db, {
      runId,
      email,
      productId: campaignProductId,
    })
    if (!verified) {
      logger.warn(
        'Instantly reply run id did not match payload contact/product; skipping direct run notification',
        {
          run_id: runId,
          campaign_product_id: campaignProductId ?? undefined,
        },
      )
      return
    }
    await markLatestRunMessageReplied(env.DB, runId, receivedAt)
    await notifySequenceRunDO(env, runId, 'reply_received', logger, 'Instantly reply')
    return
  }

  const productSlug = extractReplyProduct(data)
  if (!email) return

  const [contact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1)
  if (!contact) return

  let productId = campaignProductId
  if (!productId && productSlug) {
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, productSlug))
      .limit(1)
    productId = typeof product?.id === 'string' ? product.id : null
  }
  if (!productId) {
    if (extractInstantlyCampaignId(data)) {
      throw new Error('Instantly reply missing campaign product ownership')
    }
    return
  }

  const activeRunIds = await findActiveProductRunIds(db, contact.id, productId)
  for (const runId of activeRunIds) {
    await markLatestRunMessageReplied(env.DB, runId, receivedAt)
    await notifySequenceRunDO(env, runId, 'reply_received', logger, 'Instantly reply')
  }
}

async function resolveInstantlyCampaignProductId(
  db: ReturnType<typeof createDb>,
  data: Record<string, unknown>,
): Promise<string | null> {
  const campaignId = extractInstantlyCampaignId(data)
  if (!campaignId) return null
  const [campaign] = await db
    .select({ product_id: instantly_campaigns.product_id })
    .from(instantly_campaigns)
    .where(eq(instantly_campaigns.id, campaignId))
    .limit(1)
  return typeof campaign?.product_id === 'string' && campaign.product_id.trim() !== ''
    ? campaign.product_id
    : null
}

async function markResendMessageFailed(
  rawDb: D1Database,
  resendEmailId: string,
  receivedAt: string,
  failureReason: string,
): Promise<boolean> {
  const messageUpdate = await rawDb
    .prepare(`
    UPDATE seq_messages
    SET failed_at = ?, failure_reason = ?
    WHERE resend_message_id = ?
  `)
    .bind(receivedAt, failureReason, resendEmailId)
    .run()

  await rawDb
    .prepare(`
    UPDATE seq_steps
    SET status = 'failed', error = ?
    WHERE id = (
      SELECT step_id
      FROM seq_messages
      WHERE resend_message_id = ?
      LIMIT 1
    )
      AND status = 'sent'
  `)
    .bind(failureReason, resendEmailId)
    .run()

  await rawDb
    .prepare(`
    UPDATE seq_sequence_runs
    SET status = 'errored', completed_at = ?
    WHERE status IN ('running', 'completed')
      AND id = (
        SELECT s.run_id
        FROM seq_steps s
        JOIN seq_messages m ON m.step_id = s.id
        WHERE m.resend_message_id = ?
        LIMIT 1
      )
  `)
    .bind(receivedAt, resendEmailId)
    .run()

  return writeSucceededOrUnknown(messageUpdate)
}

type QueueEventIdentity = Pick<QueueMessage, 'provider' | 'event_id' | 'event_type' | 'message_id'>
type QueueEventClaim = { status: 'claimed'; leaseStartedAt: string | null } | 'completed' | 'busy'

function eventSideEffectsCompleted(event: unknown): boolean {
  if (!isRecord(event)) return false
  const value = event.sideEffectsCompletedAt ?? event.side_effects_completed_at
  return typeof value === 'string' && value.length > 0
}

async function findExistingQueueEvent(
  db: ReturnType<typeof createDb>,
  identity: QueueEventIdentity,
): Promise<unknown> {
  if (identity.event_id) {
    const [event] = await db
      .select({
        id: events.id,
        type: events.type,
        message_id: events.message_id,
        payload: events.payload,
        sideEffectsStartedAt: events.side_effects_started_at,
        sideEffectsCompletedAt: events.side_effects_completed_at,
      })
      .from(events)
      .where(
        and(
          eq(events.provider, identity.provider),
          eq(events.provider_event_id, identity.event_id),
        ),
      )
      .limit(1)
    return event
  }

  if (identity.provider === 'instantly' && identity.message_id) {
    const [event] = await db
      .select({
        id: events.id,
        type: events.type,
        message_id: events.message_id,
        payload: events.payload,
        sideEffectsStartedAt: events.side_effects_started_at,
        sideEffectsCompletedAt: events.side_effects_completed_at,
      })
      .from(events)
      .where(
        and(
          eq(events.provider, identity.provider),
          eq(events.message_id, identity.message_id),
          eq(events.type, identity.event_type),
        ),
      )
      .limit(1)
    return event
  }

  return null
}

function queueEventConflicts(
  event: unknown,
  identity: QueueEventIdentity,
  payload: unknown,
): boolean {
  if (!isRecord(event)) return false
  if (typeof event.type === 'string' && event.type !== identity.event_type) return true
  const existingMessageId = event.message_id ?? event.messageId
  if (
    typeof existingMessageId === 'string' &&
    identity.message_id !== null &&
    existingMessageId !== identity.message_id
  ) {
    return true
  }
  const existingPayload = event.payload
  if (isRecord(existingPayload) && isRecord(payload)) {
    return stableJson(existingPayload) !== stableJson(payload)
  }
  return false
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function claimQueueEventSideEffects(
  db: ReturnType<typeof createDb>,
  identity: QueueEventIdentity,
): Promise<QueueEventClaim> {
  if (!identity.event_id && !(identity.provider === 'instantly' && identity.message_id)) {
    return { status: 'claimed', leaseStartedAt: null }
  }

  const now = new Date().toISOString()
  const staleBefore = new Date(Date.now() - EVENT_SIDE_EFFECT_LEASE_MS).toISOString()
  const where = queueEventIdentityWhere(identity)
  if (!where) return { status: 'claimed', leaseStartedAt: null }

  const result = await db
    .update(events)
    .set({ side_effects_started_at: now })
    .where(
      and(
        where,
        isNull(events.side_effects_completed_at),
        or(isNull(events.side_effects_started_at), lt(events.side_effects_started_at, staleBefore)),
      ),
    )

  if (writeChangedRows(result)) return { status: 'claimed', leaseStartedAt: now }
  if (result === undefined) return { status: 'claimed', leaseStartedAt: now }

  const existingEvent = await findExistingQueueEvent(db, identity)
  return eventSideEffectsCompleted(existingEvent) ? 'completed' : 'busy'
}

async function releaseQueueEventSideEffectsClaim(
  db: ReturnType<typeof createDb>,
  identity: QueueEventIdentity,
  leaseStartedAt: string | null,
): Promise<void> {
  const where = queueEventIdentityWhere(identity)
  if (!where || !leaseStartedAt) return

  await db
    .update(events)
    .set({ side_effects_started_at: null })
    .where(
      and(
        where,
        eq(events.side_effects_started_at, leaseStartedAt),
        isNull(events.side_effects_completed_at),
      ),
    )
}

async function markQueueEventSideEffectsCompleted(
  db: ReturnType<typeof createDb>,
  identity: QueueEventIdentity,
  leaseStartedAt: string | null,
): Promise<boolean> {
  const completedAt = new Date().toISOString()
  const leaseWhere = queueEventIdentityWhere(identity)
  if (!leaseWhere || !leaseStartedAt) return true
  if (identity.event_id) {
    const result = await db
      .update(events)
      .set({ side_effects_completed_at: completedAt, side_effects_started_at: null })
      .where(
        and(
          leaseWhere,
          eq(events.side_effects_started_at, leaseStartedAt),
          isNull(events.side_effects_completed_at),
        ),
      )
    return writeSucceededOrUnknown(result)
  }

  if (identity.provider === 'instantly' && identity.message_id) {
    const result = await db
      .update(events)
      .set({ side_effects_completed_at: completedAt, side_effects_started_at: null })
      .where(
        and(
          leaseWhere,
          eq(events.side_effects_started_at, leaseStartedAt),
          isNull(events.side_effects_completed_at),
        ),
      )
    return writeSucceededOrUnknown(result)
  }

  return true
}

function queueEventIdentityWhere(
  identity: QueueEventIdentity,
): ReturnType<typeof and> | ReturnType<typeof eq> | null {
  if (identity.event_id) {
    return and(
      eq(events.provider, identity.provider),
      eq(events.provider_event_id, identity.event_id),
    )
  }

  if (identity.provider === 'instantly' && identity.message_id) {
    return and(
      eq(events.provider, identity.provider),
      eq(events.message_id, identity.message_id),
      eq(events.type, identity.event_type),
    )
  }

  return null
}

function writeChangedRows(result: unknown): boolean {
  const changes = writeChangeCount(result)
  return typeof changes === 'number' && changes > 0
}

function writeChangeCount(result: unknown): number | null {
  if (!isRecord(result)) return null
  const meta = result.meta
  if (isRecord(meta) && typeof meta.changes === 'number') return meta.changes
  if (typeof result.changes === 'number') return result.changes
  return null
}

function writeSucceededOrUnknown(result: unknown): boolean {
  const changes = writeChangeCount(result)
  return changes === null || changes > 0
}

function insertWasConflictNoop(result: unknown): boolean {
  if (!isRecord(result)) return false
  const meta = result.meta
  if (isRecord(meta) && typeof meta.changes === 'number') return meta.changes === 0
  if (typeof result.changes === 'number') return result.changes === 0
  return false
}

async function handleResendReplyEvent(
  env: Env,
  data: Record<string, unknown>,
  receivedAt: string,
  db: ReturnType<typeof createDb>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const fromEmail = extractEmailAddress(data.from)
  const recipientEmails = extractEmailAddressList(data.to)
  if (!fromEmail || recipientEmails.length === 0) return

  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, fromEmail))
    .limit(1)
  if (!contact || typeof contact.id !== 'string') return

  const notifiedRunIds = new Set<string>()
  const checkedProductIds = new Set<string>()
  for (const recipientEmail of recipientEmails) {
    const matchingProducts = await db
      .select({ id: products.id })
      .from(products)
      .where(
        or(
          eq(products.default_reply_to, recipientEmail),
          eq(products.default_from_email, recipientEmail),
        ),
      )

    for (const product of matchingProducts) {
      if (!product || typeof product.id !== 'string' || checkedProductIds.has(product.id)) continue
      checkedProductIds.add(product.id)

      const activeRunIds = await findActiveProductRunIds(db, contact.id, product.id)
      for (const runId of activeRunIds) {
        if (notifiedRunIds.has(runId)) continue
        notifiedRunIds.add(runId)
        await markLatestRunMessageReplied(env.DB, runId, receivedAt)
        await notifySequenceRunDO(env, runId, 'reply_received', logger, 'Resend reply')
      }
    }
  }
}

async function markLatestRunMessageReplied(
  rawDb: D1Database,
  runId: string,
  receivedAt: string,
): Promise<void> {
  await rawDb
    .prepare(`
    UPDATE seq_messages
    SET replied_at = ?
    WHERE id = (
      SELECT m.id
      FROM seq_messages m
      JOIN seq_steps s ON s.id = m.step_id
      WHERE s.run_id = ?
        AND m.replied_at IS NULL
      ORDER BY datetime(m.sent_at) DESC, datetime(m.created_at) DESC, m.id DESC
      LIMIT 1
    )
  `)
    .bind(receivedAt, runId)
    .run()
}

async function notifyActiveProductRunsByIds(
  env: Env,
  db: ReturnType<typeof createDb>,
  contactId: string,
  productId: string,
  event: string,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const activeRunIds = await findActiveProductRunIds(db, contactId, productId)

  for (const runId of activeRunIds) {
    await notifySequenceRunDO(env, runId, event, logger, event)
  }
}

async function findActiveProductRunIds(
  db: ReturnType<typeof createDb>,
  contactId: string,
  productId: string,
): Promise<string[]> {
  const activeRuns = await db
    .select({ id: sequence_runs.id })
    .from(sequence_runs)
    .where(
      and(
        eq(sequence_runs.contact_id, contactId),
        eq(sequence_runs.product_id, productId),
        eq(sequence_runs.status, 'running'),
      ),
    )
    .limit(100)

  return activeRuns.map((run) => run.id).filter((id): id is string => typeof id === 'string')
}

async function directRunMatchesProviderEvent(
  db: ReturnType<typeof createDb>,
  input: {
    runId: string
    email: string | null
    productId: string | null
  },
): Promise<boolean> {
  const conditions = [eq(sequence_runs.id, input.runId), eq(sequence_runs.status, 'running')]
  if (input.productId) conditions.push(eq(sequence_runs.product_id, input.productId))
  if (input.email) conditions.push(eq(contacts.email, input.email))

  const [run] = await db
    .select({ id: sequence_runs.id })
    .from(sequence_runs)
    .innerJoin(contacts, eq(sequence_runs.contact_id, contacts.id))
    .where(and(...conditions))
    .limit(1)

  return typeof run?.id === 'string'
}

async function notifySequenceRunDO(
  env: Env,
  runId: string,
  event: string,
  logger: ReturnType<typeof createLogger>,
  source: string,
): Promise<void> {
  try {
    const doId = env.SEQUENCE_RUN.idFromName(runId)
    const stub = env.SEQUENCE_RUN.get(doId)
    const response = await stub.fetch(
      new Request('https://do/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      }),
    )
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '')
      throw new Error(`DO ${source} notification failed with ${response.status}: ${responseBody}`)
    }
  } catch (err) {
    logger.warn(`Failed to notify DO of ${source}`, {
      run_id: runId,
      error: (err as Error).message,
    })
    throw err
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractRunId(data: Record<string, unknown>): string | null {
  const value = data.run_id ?? data.runId
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function extractReplyEmail(data: Record<string, unknown>): string | null {
  const value = data.email ?? data.lead_email ?? data.leadEmail
  if (typeof value !== 'string') return null

  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function extractReplyProduct(data: Record<string, unknown>): string | null {
  const value = data.product ?? data.product_slug ?? data.productSlug
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null
}

function extractInstantlyCampaignId(data: Record<string, unknown>): string | null {
  const value = data.campaign_id ?? data.campaignId
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function extractResendEmail(data: Record<string, unknown>): string | null {
  const raw = data.to
  const value = Array.isArray(raw)
    ? raw.find((entry) => typeof entry === 'string')
    : (raw ?? data.email)

  if (typeof value !== 'string') return null

  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function extractEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const bracketed = /<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/.exec(value)
  const candidate = (bracketed?.[1] ?? value).trim().toLowerCase()
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate) ? candidate : null
}

function extractEmailAddressList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return [
    ...new Set(values.map(extractEmailAddress).filter((email): email is string => email !== null)),
  ]
}

type ResendTag = { name: string; value: string }

function extractResendTags(value: unknown): ResendTag[] {
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          entry[0].trim() !== '' && typeof entry[1] === 'string' && entry[1].trim() !== '',
      )
      .map(([name, tagValue]) => ({ name, value: tagValue }))
  }
  if (!Array.isArray(value)) return []
  return value.filter(
    (tag): tag is ResendTag =>
      isRecord(tag) &&
      typeof tag.name === 'string' &&
      typeof tag.value === 'string' &&
      tag.name.trim() !== '' &&
      tag.value.trim() !== '',
  )
}

function getResendTagValue(tags: ResendTag[], name: string): string | null {
  return tags.find((tag) => tag.name === name)?.value ?? null
}
