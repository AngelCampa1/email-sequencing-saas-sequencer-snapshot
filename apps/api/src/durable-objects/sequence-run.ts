import {
  contact_products,
  contacts,
  createDb,
  messages,
  products,
  sequence_runs,
  sequences,
  steps,
} from '@sequencer/db'
import type { SequenceDefinition } from '@sequencer/shared'
import { and, eq, ne } from 'drizzle-orm'
import { buildEmailTemplateProps } from '../lib/email-branding'
import { checkFirewall } from '../lib/firewall'
import { createLogger, trackMetric } from '../lib/observability'
import { parseDelay } from '../lib/parse-delay'
import {
  DEFAULT_SEND_TIME_ZONE,
  nextAllowedSendTime,
  resolveSendTimeZone,
} from '../lib/send-window'
import { checkSuppression } from '../lib/suppression'
import { createResendAdapter } from '../providers/resend'
import type { Env } from '../types'

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] // 1m, 5m, 15m
const EVENT_ALIASES: Record<string, string[]> = {
  replied: ['reply_received'],
  reply_received: ['replied'],
}

interface DOState {
  runId: string
  contactId: string
  contactEmail: string
  productId: string
  productSlug: string
  sequenceSlug: string
  sequenceVersion: number
  currentStepIndex: number
  variantId: string | null
  retryCount: number
  status: 'running' | 'completed' | 'exited' | 'errored' | 'paused'
  receivedEvents?: string[]
}

type RunStatus = DOState['status']

type StartRequestBody = {
  runId: string
  contactId: string
  contactEmail: string
  productId: string
  productSlug: string
  sequenceSlug: string
  sequenceVersion: number
  variantId: string | null
}

class ControlRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
  ) {
    super(publicMessage)
  }
}

function toLocalTerminalStatus(dbStatus: RunStatus | null): RunStatus {
  if (dbStatus === 'completed' || dbStatus === 'errored' || dbStatus === 'paused') return dbStatus
  return 'exited'
}

export class SequenceRunDO implements DurableObject {
  private state: DurableObjectState
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const logger = createLogger(this.env)

    try {
      switch (url.pathname) {
        case '/start': {
          const body = await readControlBody(request)
          if (!isStartRequestBody(body)) return jsonResponse({ error: 'Invalid request' }, 400)
          await this.start(body)
          return jsonResponse({ ok: true })
        }
        case '/cancel': {
          const body = await readControlBody(request)
          if (typeof body?.reason !== 'string')
            return jsonResponse({ error: 'Invalid request' }, 400)
          await this.cancel(body.reason)
          return jsonResponse({ ok: true })
        }
        case '/event': {
          const body = await readControlBody(request)
          if (!isEventRequestBody(body)) return jsonResponse({ error: 'Invalid request' }, 400)
          await this.handleEvent(body.event, body.properties)
          return jsonResponse({ ok: true })
        }
        case '/status': {
          const doState = await this.loadState()
          return jsonResponse(doState)
        }
        default:
          return new Response('Not found', { status: 404 })
      }
    } catch (err) {
      if (err instanceof ControlRequestError) {
        return jsonResponse({ error: err.publicMessage }, err.status)
      }
      logger.error('SequenceRunDO fetch error', {
        error: (err as Error).message,
        path: url.pathname,
      })
      return jsonResponse({ error: (err as Error).message }, 500)
    }
  }

  async alarm(): Promise<void> {
    const logger = createLogger(this.env)
    const doState = await this.loadState()

    if (doState?.status !== 'running') {
      logger.info('DO alarm: run not active, skipping', { run_id: doState?.runId })
      return
    }

    const dbStatus = await this.loadRunStatus(doState.runId)
    if (dbStatus !== 'running') {
      logger.info('DO alarm: D1 run not active, exiting local state', {
        run_id: doState.runId,
        db_status: dbStatus ?? 'missing',
      })
      await this.saveState({ ...doState, status: toLocalTerminalStatus(dbStatus) })
      await this.state.storage.deleteAlarm()
      return
    }

    logger.info('DO alarm: executing step', {
      run_id: doState.runId,
      step_index: String(doState.currentStepIndex),
      sequence_slug: doState.sequenceSlug,
    })

    try {
      await this.executeStep(doState)
    } catch (err) {
      logger.error('DO alarm: step execution failed', {
        run_id: doState.runId,
        error: (err as Error).message,
        retry_count: String(doState.retryCount),
      })

      const retryCount = doState.retryCount + 1
      await this.recordStepError(
        doState.runId,
        doState.currentStepIndex,
        doState.sequenceSlug,
        doState.variantId,
        (err as Error).message,
        retryCount > MAX_RETRIES ? 'failed' : 'pending',
      )
      if (retryCount <= MAX_RETRIES) {
        const delayMs =
          RETRY_DELAYS_MS[retryCount - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
        const sendTimeZone = await this.loadContactSendTimeZone(
          doState.contactId,
          doState.productId,
        )
        await this.saveState({ ...doState, retryCount })
        await this.state.storage.setAlarm(this.nextAllowedAlarmTime(delayMs, sendTimeZone))
        logger.info('Retry scheduled', {
          run_id: doState.runId,
          retry: String(retryCount),
          delay_ms: String(delayMs),
        })
      } else {
        // Exhausted retries - mark as errored, send to dead-letter queue
        await this.markStatus(doState.runId, 'errored')
        await this.saveState({ ...doState, status: 'errored' })

        trackMetric(this.env.ANALYTICS, {
          name: 'send.failed',
          dims: {
            product: doState.productSlug,
            sequence: doState.sequenceSlug,
            step: String(doState.currentStepIndex),
            error: (err as Error).message.slice(0, 50),
          },
        })

        try {
          await this.env.DEAD_LETTER_QUEUE.send({
            type: 'step_exhausted',
            run_id: doState.runId,
            step_index: doState.currentStepIndex,
            error: (err as Error).message,
          })
        } catch (dlqErr) {
          const dlqErrorMessage = dlqErr instanceof Error ? dlqErr.message : String(dlqErr)
          logger.error('Failed to send exhausted step to dead-letter queue', {
            run_id: doState.runId,
            step_index: String(doState.currentStepIndex),
            error: dlqErrorMessage,
          })
          trackMetric(this.env.ANALYTICS, {
            name: 'dead_letter.failed',
            dims: {
              product: doState.productSlug,
              sequence: doState.sequenceSlug,
              step: String(doState.currentStepIndex),
              error: dlqErrorMessage.slice(0, 50),
            },
          })
        }
      }
    }
  }

  private async start(params: StartRequestBody): Promise<void> {
    const initialState: DOState = {
      ...params,
      currentStepIndex: 0,
      retryCount: 0,
      status: 'running',
    }

    // Honor step 0's declared delay (with a 1s floor to let the enrollment txn settle).
    let firstDelayMs = 1000
    try {
      const db = createDb(this.env.DB)
      const [seqRow] = await db
        .select({
          product_id: sequences.product_id,
          version: sequences.version,
          definition: sequences.definition,
        })
        .from(sequences)
        .where(eq(sequences.slug, params.sequenceSlug))
        .limit(1)
      if (!seqRow) {
        throw new ControlRequestError(404, 'Sequence not found')
      }
      if (typeof seqRow.product_id === 'string' && seqRow.product_id !== params.productId) {
        throw new ControlRequestError(409, 'Sequence does not belong to product')
      }
      if (typeof seqRow.version === 'number' && seqRow.version !== params.sequenceVersion) {
        throw new ControlRequestError(409, 'Sequence version mismatch')
      }
      const def = seqRow?.definition as SequenceDefinition | undefined
      const declared = def?.steps?.[0]?.delay
      if (declared) firstDelayMs = Math.max(1000, parseDelay(declared))
    } catch (err) {
      if (err instanceof ControlRequestError) throw err
      // Fall back to 1s if sequence lookup fails - alarm will surface the error.
    }
    const sendTimeZone = await this.loadContactSendTimeZone(params.contactId, params.productId)
    await this.saveState(initialState)
    await this.state.storage.setAlarm(this.nextAllowedAlarmTime(firstDelayMs, sendTimeZone))
  }

  private async cancel(reason: string): Promise<void> {
    const doState = await this.loadState()
    if (!doState) return
    await this.markStatus(doState.runId, 'exited')
    await this.saveState({ ...doState, status: 'exited' })
    await this.state.storage.deleteAlarm()
    createLogger(this.env).info('Run cancelled', { run_id: doState.runId, reason })
  }

  private async errorRun(doState: DOState, reason: string): Promise<void> {
    await this.markStatus(doState.runId, 'errored')
    await this.saveState({ ...doState, status: 'errored' })
    await this.state.storage.deleteAlarm()
    createLogger(this.env).error('Run errored', { run_id: doState.runId, reason })
  }

  private async handleEvent(event: string, _properties?: Record<string, unknown>): Promise<void> {
    const doState = await this.loadState()
    if (doState?.status !== 'running') return

    if (equivalentEventNames(event).includes('unsubscribed')) {
      await this.cancel(`event:${event}`)
      return
    }

    // Check if this event matches an exit condition
    const db = createDb(this.env.DB)
    const [seqRow] = await db
      .select({ exit_conditions: sequences.exit_conditions })
      .from(sequences)
      .where(eq(sequences.slug, doState.sequenceSlug))
      .limit(1)

    if (!seqRow) return

    const eventNames = new Set(equivalentEventNames(event))
    const exitConditions = Array.isArray(seqRow.exit_conditions)
      ? (seqRow.exit_conditions as Array<{ event: string }>)
      : []
    const shouldExit = exitConditions.some((c) =>
      equivalentEventNames(c.event).some((exitEvent) => eventNames.has(exitEvent)),
    )
    if (shouldExit) {
      await this.cancel(`exit_condition:${event}`)
      return
    }

    await this.saveState({
      ...doState,
      receivedEvents: rememberEvent(doState.receivedEvents, event),
    })
  }

  private async executeStep(doState: DOState): Promise<void> {
    const logger = createLogger(this.env, {
      run_id: doState.runId,
      sequence_slug: doState.sequenceSlug,
      step_id: String(doState.currentStepIndex),
      product: doState.productSlug,
    })

    const db = createDb(this.env.DB)

    // Load sequence definition
    const [seqRow] = await db
      .select()
      .from(sequences)
      .where(eq(sequences.slug, doState.sequenceSlug))
      .limit(1)

    if (!seqRow) {
      throw new Error(`Sequence not found: ${doState.sequenceSlug}`)
    }

    if (typeof seqRow.product_id === 'string' && seqRow.product_id !== doState.productId) {
      logger.error('Sequence product mismatch; refusing to send', {
        sequence_product_id: seqRow.product_id,
        run_product_id: doState.productId,
      })
      await this.errorRun(
        doState,
        `sequence_product_mismatch:${seqRow.product_id}->${doState.productId}`,
      )
      return
    }

    if (typeof seqRow.version === 'number' && seqRow.version !== doState.sequenceVersion) {
      logger.error('Sequence version changed mid-run; refusing to send', {
        stored_version: doState.sequenceVersion,
        synced_version: seqRow.version,
      })
      await this.errorRun(
        doState,
        `sequence_version_changed:${doState.sequenceVersion}->${seqRow.version}`,
      )
      return
    }

    const definition = seqRow.definition as SequenceDefinition
    const step = definition.steps[doState.currentStepIndex]

    if (seqRow.is_active === false || (seqRow.is_active as unknown) === 0) {
      logger.warn('Step skipped: sequence inactive', { sequence_slug: doState.sequenceSlug })
      trackMetric(this.env.ANALYTICS, {
        name: 'send.skipped',
        dims: {
          product: doState.productSlug,
          sequence: doState.sequenceSlug,
          step: step?.id ?? String(doState.currentStepIndex),
          reason: 'sequence_inactive',
        },
      })
      await this.cancel('sequence_inactive')
      return
    }

    if (!step) {
      // No more steps - mark completed
      await this.markStatus(doState.runId, 'completed', doState.currentStepIndex)
      await this.saveState({ ...doState, status: 'completed' })
      logger.info('Sequence completed', { run_id: doState.runId })
      return
    }

    // Resolve subject for variant (fall back to control, then first declared variant)
    let subject: string
    if (typeof step.subject === 'string') {
      subject = step.subject
    } else {
      const subjectMap = step.subject as Record<string, string>
      subject =
        subjectMap[doState.variantId ?? 'control'] ??
        subjectMap.control ??
        Object.values(subjectMap)[0] ??
        ''
    }

    // Idempotency: if a step row at this index is already 'sent', the previous
    // alarm succeeded mid-flight and we must not re-send or let unrelated
    // rendering/provider checks strand the run on this step.
    const existingStep = await db
      .select({
        id: steps.id,
        status: steps.status,
        messageId: steps.message_id,
        sentAt: steps.sent_at,
      })
      .from(steps)
      .where(and(eq(steps.run_id, doState.runId), eq(steps.step_index, doState.currentStepIndex)))
      .limit(1)

    if (existingStep[0]?.status === 'sent') {
      logger.warn('Step already sent (idempotency hit), advancing', { step_id: step.id })
      await this.backfillSentStepMessageBestEffort(
        doState,
        existingStep[0],
        step.template,
        subject,
        logger,
      )
      await this.advanceToNextStep(doState, definition)
      return
    }

    if (existingStep[0]) {
      const existingMessage = await this.loadMessageForStep(existingStep[0].id)
      if (existingMessage) {
        logger.warn('Step message already exists for pending step, repairing sent state', {
          step_id: step.id,
        })
        await db
          .update(steps)
          .set({
            sent_at: existingMessage.sentAt,
            message_id: existingMessage.resendMessageId,
            status: 'sent',
          })
          .where(eq(steps.id, existingStep[0].id))
        await this.advanceToNextStep(doState, definition)
        return
      }
    }

    // Check suppression
    const suppCheck = await checkSuppression(this.env, doState.contactEmail, doState.productId)
    if (suppCheck.suppressed) {
      logger.info('Step skipped: suppressed', { reason: suppCheck.reason })
      trackMetric(this.env.ANALYTICS, {
        name: 'send.skipped',
        dims: {
          product: doState.productSlug,
          sequence: doState.sequenceSlug,
          step: step.id,
          reason: `suppressed:${suppCheck.scope}`,
        },
      })
      await this.cancel(`suppression:${suppCheck.reason ?? suppCheck.scope ?? 'suppressed'}`)
      return
    }

    // Re-check any configured product firewall before each send.
    const fwCheck = await checkFirewall(this.env, doState.contactEmail, doState.productId)
    if (fwCheck.blocked) {
      logger.warn('Step skipped: firewall', { reason: fwCheck.reason })
      trackMetric(this.env.ANALYTICS, {
        name: 'send.skipped',
        dims: {
          product: doState.productSlug,
          sequence: doState.sequenceSlug,
          step: step.id,
          reason: 'firewall',
        },
      })
      await this.cancel(`firewall:${fwCheck.reason ?? 'partner_collision'}`)
      return
    }

    // Check skip_if conditions
    if (step.skip_if) {
      const shouldSkip = await this.evaluateSkipIf(doState, step.skip_if)
      if (shouldSkip) {
        logger.info('Step skipped: skip_if matched', { step_id: step.id })
        trackMetric(this.env.ANALYTICS, {
          name: 'send.skipped',
          dims: {
            product: doState.productSlug,
            sequence: doState.sequenceSlug,
            step: step.id,
            reason: 'skip_if',
          },
        })
        await this.advanceToNextStep(doState, definition)
        return
      }
    }

    const sendTimeZone = await this.loadContactSendTimeZone(doState.contactId, doState.productId)
    const nowMs = Date.now()
    const nextSendTime = nextAllowedSendTime(nowMs, sendTimeZone)
    if (nextSendTime > nowMs) {
      logger.info('Step deferred: outside send window', {
        time_zone: sendTimeZone,
        next_send_at: new Date(nextSendTime).toISOString(),
      })
      await this.state.storage.setAlarm(nextSendTime)
      return
    }

    // Load product info for from_email
    const [product] = await db
      .select({
        name: products.name,
        brand_color: products.brand_color,
        default_from_email: products.default_from_email,
        default_reply_to: products.default_reply_to,
        resend_api_key_secret_name: products.resend_api_key_secret_name,
      })
      .from(products)
      .where(eq(products.id, doState.productId))
      .limit(1)

    if (!product) throw new Error(`Product not found: ${doState.productId}`)

    // Render template using React Email components
    const { renderEmailForTemplate } = await import('../lib/template-renderer')
    if (!this.env.UNSUBSCRIBE_SIGNING_SECRET) {
      throw new Error('UNSUBSCRIBE_SIGNING_SECRET is not configured')
    }

    const contactProfile = await this.loadContactTemplateProfile(
      doState.contactId,
      doState.productId,
    )
    const { html, text } = await renderEmailForTemplate(
      step.template,
      await buildEmailTemplateProps({
        contactEmail: doState.contactEmail,
        firstName: contactProfile.firstName,
        productSlug: doState.productSlug,
        productName: product.name,
        brandColor: product.brand_color,
        subject,
        sequenceSlug: doState.sequenceSlug,
        unsubscribeSigningSecret: this.env.UNSUBSCRIBE_SIGNING_SECRET,
      }),
    )

    // Reserve a pending step row up front so retries are bounded by row presence.
    const stepId = existingStep[0]?.id ?? crypto.randomUUID()
    const nowReserve = new Date().toISOString()
    if (!existingStep[0]) {
      await db.insert(steps).values({
        id: stepId,
        run_id: doState.runId,
        step_index: doState.currentStepIndex,
        scheduled_for: nowReserve,
        template_slug: step.template,
        variant: doState.variantId,
        status: 'pending',
      })
    }

    // Track attempt
    trackMetric(this.env.ANALYTICS, {
      name: 'send.attempted',
      dims: {
        product: doState.productSlug,
        sequence: doState.sequenceSlug,
        step: step.id,
        variant: doState.variantId ?? 'control',
      },
    })

    // Send via Resend
    const resend = createResendAdapter(
      this.env,
      doState.productSlug,
      product.resend_api_key_secret_name,
    )
    const result = await resend.send({
      to: doState.contactEmail,
      from: product.default_from_email,
      replyTo: product.default_reply_to ?? undefined,
      subject,
      html,
      text,
      idempotencyKey: `sequencer:${doState.runId}:${doState.currentStepIndex}`,
      tags: [
        { name: 'sequence', value: doState.sequenceSlug },
        { name: 'step', value: step.id },
        { name: 'product', value: doState.productSlug },
        { name: 'run_id', value: doState.runId },
      ],
    })

    // Persist the provider id before R2 archiving so fast Resend webhooks can
    // resolve message context instead of completing against no message row.
    const now = new Date().toISOString()
    await this.ensureMessageRecord({
      stepId,
      contactId: doState.contactId,
      productId: doState.productId,
      resendMessageId: result.id,
      subject,
      fromEmail: product.default_from_email,
      sentAt: now,
    })

    const htmlR2Key = await this.archiveRenderedHtml({
      html,
      productSlug: doState.productSlug,
      sequenceSlug: doState.sequenceSlug,
      runId: doState.runId,
      stepIndex: doState.currentStepIndex,
      resendMessageId: result.id,
      logger,
    })

    // Flip the reserved step row to 'sent'
    await db
      .update(steps)
      .set({ sent_at: now, message_id: result.id, status: 'sent' })
      .where(eq(steps.id, stepId))

    if (htmlR2Key) {
      await db
        .update(messages)
        .set({ html_r2_key: htmlR2Key })
        .where(eq(messages.resend_message_id, result.id))
    }

    trackMetric(this.env.ANALYTICS, {
      name: 'send.sent',
      dims: {
        product: doState.productSlug,
        sequence: doState.sequenceSlug,
        step: step.id,
        variant: doState.variantId ?? 'control',
      },
    })

    logger.info('Step sent', { step_id: step.id, resend_message_id: result.id })

    // Advance to next step
    await this.advanceToNextStep(doState, definition)
  }

  private async advanceToNextStep(doState: DOState, definition: SequenceDefinition): Promise<void> {
    const nextIndex = doState.currentStepIndex + 1

    if (nextIndex >= definition.steps.length) {
      // Sequence complete
      await this.markStatus(doState.runId, 'completed', nextIndex)
      await this.saveState({
        ...doState,
        currentStepIndex: nextIndex,
        status: 'completed',
        retryCount: 0,
      })
      return
    }

    const nextStep = definition.steps[nextIndex]
    const delayMs = parseDelay(nextStep.delay)

    const sendTimeZone = await this.loadContactSendTimeZone(doState.contactId, doState.productId)
    const nextAlarmTime = this.nextAllowedAlarmTime(delayMs, sendTimeZone)
    await this.updateCurrentStepIndex(doState.runId, nextIndex, doState)
    await this.saveState({ ...doState, currentStepIndex: nextIndex, retryCount: 0 })
    await this.state.storage.setAlarm(nextAlarmTime)
  }

  private nextAllowedAlarmTime(delayMs: number, sendTimeZone: string): number {
    return nextAllowedSendTime(Date.now() + delayMs, sendTimeZone)
  }

  private async evaluateSkipIf(
    doState: DOState,
    skipIf: Record<string, unknown>,
  ): Promise<boolean> {
    // Check recent events for THIS contact (the email lives in the payload JSON
    // emitted by /api/v1/events). We resolve contact rows once for the loop.
    const db = createDb(this.env.DB)
    const [contactRow] = await db
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, doState.contactId))
      .limit(1)
    if (!contactRow) return false

    for (const [eventType, expected] of Object.entries(skipIf)) {
      if (expected !== true) continue

      if (hasMatchingRuntimeEvent(doState.receivedEvents, eventType)) {
        return true
      }

      for (const eventName of equivalentEventNames(eventType)) {
        const matched = await this.hasMatchingInternalEvent(
          eventName,
          contactRow.email,
          doState.productSlug,
        )
        if (matched) return true
      }
    }

    return false
  }

  private async hasMatchingInternalEvent(
    eventType: string,
    email: string,
    productSlug: string,
  ): Promise<boolean> {
    const row = await this.env.DB.prepare(`
      SELECT 1 AS matched
      FROM seq_events
      WHERE type = ?
        AND provider = 'internal'
        AND json_extract(payload, '$.email') = ?
        AND json_extract(payload, '$.product') = ?
      LIMIT 1
    `)
      .bind(eventType, email, productSlug)
      .first<{ matched: number }>()

    return row?.matched === 1
  }

  private async markStatus(
    runId: string,
    status: RunStatus,
    currentStepIndex?: number,
  ): Promise<void> {
    const db = createDb(this.env.DB)
    const updates: Record<string, unknown> = { status }
    if (typeof currentStepIndex === 'number') {
      updates.current_step_index = currentStepIndex
    }
    if (status === 'completed' || status === 'exited' || status === 'errored') {
      updates.completed_at = new Date().toISOString()
    }
    await db
      .update(sequence_runs)
      .set(updates as any)
      .where(eq(sequence_runs.id, runId))
  }

  private async ensureMessageRecord(input: {
    stepId: string
    contactId: string
    productId: string
    resendMessageId: string | null
    subject: string
    fromEmail: string
    sentAt: string | null
    htmlArchive?: {
      html: string
      productSlug: string
      sequenceSlug: string
      runId: string
      stepIndex: number
      logger: ReturnType<typeof createLogger>
    }
  }): Promise<void> {
    if (!input.resendMessageId || !input.sentAt) return

    const db = createDb(this.env.DB)
    const existing = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.resend_message_id, input.resendMessageId))
      .limit(1)

    if (existing[0]) return
    const htmlR2Key = input.htmlArchive
      ? await this.archiveRenderedHtml({
          ...input.htmlArchive,
          resendMessageId: input.resendMessageId,
        })
      : null

    await db.insert(messages).values({
      step_id: input.stepId,
      contact_id: input.contactId,
      product_id: input.productId,
      resend_message_id: input.resendMessageId,
      subject: input.subject,
      from_email: input.fromEmail,
      html_r2_key: htmlR2Key,
      sent_at: input.sentAt,
    })
  }

  private async loadMessageForStep(stepId: string): Promise<{
    resendMessageId: string | null
    sentAt: string | null
  } | null> {
    const db = createDb(this.env.DB)
    const [message] = await db
      .select({
        resendMessageId: messages.resend_message_id,
        sentAt: messages.sent_at,
      })
      .from(messages)
      .where(eq(messages.step_id, stepId))
      .limit(1)

    if (!message) return null
    return {
      resendMessageId: typeof message.resendMessageId === 'string' ? message.resendMessageId : null,
      sentAt: typeof message.sentAt === 'string' ? message.sentAt : new Date().toISOString(),
    }
  }

  private async backfillSentStepMessageBestEffort(
    doState: DOState,
    sentStep: {
      id: string
      messageId: string | null
      sentAt: string | null
    },
    templateSlug: string,
    subject: string,
    logger: ReturnType<typeof createLogger>,
  ): Promise<void> {
    try {
      const db = createDb(this.env.DB)
      const [product] = await db
        .select({
          name: products.name,
          brand_color: products.brand_color,
          default_from_email: products.default_from_email,
        })
        .from(products)
        .where(eq(products.id, doState.productId))
        .limit(1)

      if (!product) return
      if (!this.env.UNSUBSCRIBE_SIGNING_SECRET) return

      const { renderEmailForTemplate } = await import('../lib/template-renderer')
      const contactProfile = await this.loadContactTemplateProfile(
        doState.contactId,
        doState.productId,
      )
      const { html } = await renderEmailForTemplate(
        templateSlug,
        await buildEmailTemplateProps({
          contactEmail: doState.contactEmail,
          firstName: contactProfile.firstName,
          productSlug: doState.productSlug,
          productName: product.name,
          brandColor: product.brand_color,
          subject,
          sequenceSlug: doState.sequenceSlug,
          unsubscribeSigningSecret: this.env.UNSUBSCRIBE_SIGNING_SECRET,
        }),
      )

      await this.ensureMessageRecord({
        stepId: sentStep.id,
        contactId: doState.contactId,
        productId: doState.productId,
        resendMessageId: sentStep.messageId,
        subject,
        fromEmail: product.default_from_email,
        sentAt: sentStep.sentAt,
        htmlArchive: {
          html,
          productSlug: doState.productSlug,
          sequenceSlug: doState.sequenceSlug,
          runId: doState.runId,
          stepIndex: doState.currentStepIndex,
          logger,
        },
      })
    } catch (error) {
      logger.warn('Failed to backfill already-sent step message row', {
        run_id: doState.runId,
        step_index: String(doState.currentStepIndex),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async loadContactTemplateProfile(
    contactId: string,
    productId: string,
  ): Promise<{ firstName: string | null }> {
    const db = createDb(this.env.DB)
    const [productContact] = await db
      .select({
        firstName: contact_products.first_name,
      })
      .from(contact_products)
      .where(
        and(eq(contact_products.contact_id, contactId), eq(contact_products.product_id, productId)),
      )
      .limit(1)

    const productFirstName = firstString(productContact, 'firstName', 'first_name')
    if (productFirstName) {
      return { firstName: productFirstName }
    }

    const [contact] = await db
      .select({
        firstName: contacts.first_name,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)

    return {
      firstName: firstString(contact, 'firstName', 'first_name'),
    }
  }

  private async loadContactSendTimeZone(contactId: string, productId: string): Promise<string> {
    try {
      const db = createDb(this.env.DB)
      const [productContact] = await db
        .select({
          properties: contact_products.properties,
        })
        .from(contact_products)
        .where(
          and(
            eq(contact_products.contact_id, contactId),
            eq(contact_products.product_id, productId),
          ),
        )
        .limit(1)

      const [contact] = await db
        .select({
          properties: contacts.properties,
        })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)

      return resolveSendTimeZone(
        recordProperty(contact, 'properties'),
        recordProperty(productContact, 'properties'),
      )
    } catch (err) {
      createLogger(this.env).warn('Falling back to default send timezone', {
        contact_id: contactId,
        product_id: productId,
        error: err instanceof Error ? err.message : String(err),
      })
      return DEFAULT_SEND_TIME_ZONE
    }
  }

  private async archiveRenderedHtml(input: {
    html: string
    productSlug: string
    sequenceSlug: string
    runId: string
    stepIndex: number
    resendMessageId: string
    logger: ReturnType<typeof createLogger>
  }): Promise<string | null> {
    const key = [
      'emails',
      safeR2PathSegment(input.productSlug),
      safeR2PathSegment(input.sequenceSlug),
      safeR2PathSegment(input.runId),
      `${input.stepIndex}-${safeR2PathSegment(input.resendMessageId)}.html`,
    ].join('/')

    try {
      await this.env.LOGS_BUCKET.put(key, input.html, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      })
      return key
    } catch (err) {
      input.logger.warn('Failed to archive rendered email HTML', {
        key,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private async updateCurrentStepIndex(
    runId: string,
    currentStepIndex: number,
    doState: DOState,
  ): Promise<void> {
    const db = createDb(this.env.DB)
    try {
      await db
        .update(sequence_runs)
        .set({ current_step_index: currentStepIndex })
        .where(eq(sequence_runs.id, runId))
    } catch (err) {
      createLogger(this.env).warn('Failed to mirror current step index to D1', {
        run_id: runId,
        step_index: String(currentStepIndex),
        product: doState.productSlug,
        sequence_slug: doState.sequenceSlug,
        error: (err as Error).message,
      })
    }
  }

  private async loadRunStatus(runId: string): Promise<RunStatus | null> {
    const db = createDb(this.env.DB)
    const [run] = await db
      .select({ status: sequence_runs.status })
      .from(sequence_runs)
      .where(eq(sequence_runs.id, runId))
      .limit(1)

    return run?.status ?? null
  }

  private async recordStepError(
    runId: string,
    stepIndex: number,
    sequenceSlug: string,
    variantId: string | null,
    error: string,
    status: 'pending' | 'failed',
  ): Promise<void> {
    const db = createDb(this.env.DB)
    const [step] = await db
      .select({ status: steps.status })
      .from(steps)
      .where(and(eq(steps.run_id, runId), eq(steps.step_index, stepIndex)))
      .limit(1)

    if (step?.status === 'sent') {
      createLogger(this.env).warn('Skipping step error update because step is already sent', {
        run_id: runId,
        step_index: String(stepIndex),
        error,
      })
      return
    }

    if (!step) {
      await db.insert(steps).values({
        run_id: runId,
        step_index: stepIndex,
        scheduled_for: new Date().toISOString(),
        template_slug: await this.resolveStepTemplateSlug(sequenceSlug, stepIndex),
        variant: variantId,
        status,
        error,
      })
      return
    }

    await db
      .update(steps)
      .set({ error, status })
      .where(
        and(eq(steps.run_id, runId), eq(steps.step_index, stepIndex), ne(steps.status, 'sent')),
      )
  }

  private async resolveStepTemplateSlug(sequenceSlug: string, stepIndex: number): Promise<string> {
    const db = createDb(this.env.DB)
    const [seqRow] = await db
      .select({ definition: sequences.definition })
      .from(sequences)
      .where(eq(sequences.slug, sequenceSlug))
      .limit(1)

    const definition = seqRow?.definition as SequenceDefinition | undefined
    return definition?.steps?.[stepIndex]?.template ?? `${sequenceSlug}:${stepIndex}`
  }

  private async loadState(): Promise<DOState | null> {
    const value = await this.state.storage.get<DOState>('state')
    return value ?? null
  }

  private async saveState(state: DOState): Promise<void> {
    await this.state.storage.put('state', state)
  }
}

async function readControlBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return isPlainObject(body) ? body : null
  } catch {
    return null
  }
}

function isStartRequestBody(body: Record<string, unknown> | null): body is StartRequestBody {
  return (
    body !== null &&
    typeof body.runId === 'string' &&
    typeof body.contactId === 'string' &&
    typeof body.contactEmail === 'string' &&
    typeof body.productId === 'string' &&
    typeof body.productSlug === 'string' &&
    typeof body.sequenceSlug === 'string' &&
    typeof body.sequenceVersion === 'number' &&
    Number.isFinite(body.sequenceVersion) &&
    (body.variantId === null || typeof body.variantId === 'string')
  )
}

function isEventRequestBody(
  body: Record<string, unknown> | null,
): body is { event: string; properties?: Record<string, unknown> } {
  return (
    body !== null &&
    typeof body.event === 'string' &&
    (body.properties === undefined || isPlainObject(body.properties))
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function equivalentEventNames(event: string): string[] {
  return [event, ...(EVENT_ALIASES[event] ?? [])]
}

function rememberEvent(events: string[] | undefined, event: string): string[] {
  return [...new Set([...(events ?? []), event])].slice(-20)
}

function hasMatchingRuntimeEvent(events: string[] | undefined, event: string): boolean {
  if (!events || events.length === 0) return false
  const eventNames = new Set(equivalentEventNames(event))
  return events.some((receivedEvent) =>
    equivalentEventNames(receivedEvent).some((alias) => eventNames.has(alias)),
  )
}

function safeR2PathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function firstString(row: unknown, ...keys: string[]): string | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

function recordProperty(row: unknown, key: string): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null
  const value = (row as Record<string, unknown>)[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
