import * as Sentry from '@sentry/cloudflare'
import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { SequenceRunDO } from './durable-objects/sequence-run'
import { requireProductApiClientContext } from './lib/product-api-auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { contactsRoute } from './routes/api/v1/contacts'
import { enrollmentsRoute } from './routes/api/v1/enrollments'
import { eventsRoute } from './routes/api/v1/events'
import { leadMagnetAssetsRoute, leadMagnetsRoute } from './routes/api/v1/lead-magnets'
import { listsRoute } from './routes/api/v1/lists'
import { oneClickUnsubscribe, unsubscribeRoute } from './routes/api/v1/unsubscribe'
import { internalRoute } from './routes/internal/index'
import { meRoute } from './routes/me'
import type { Env } from './types'
import { instantlyWebhookRoute } from './webhooks/instantly'
import { resendWebhookRoute } from './webhooks/resend'

export { SequenceRunDO }

const app = new Hono<{ Bindings: Env }>()
const dashboardCors = cors({
  origin: ['https://sequencer.ventoralabs.com', 'http://localhost:5173'],
  allowHeaders: [
    'Content-Type',
    'CF-Access-Client-Id',
    'CF-Access-Client-Secret',
    'Idempotency-Key',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
})

app.use('*', logger())
app.use('/api/*', dashboardCors)
app.use('/me', dashboardCors)

// Rate limiting for all product API endpoints.
app.use('/api/v1/*', productApiRateLimit)
app.use('/api/client/v1/*', productApiRateLimit)

async function productApiRateLimit(c: Context<{ Bindings: Env }>, next: Next) {
  const pathname = new URL(c.req.url).pathname
  const pathParts = pathname.split('/')
  const endpoint =
    pathParts[2] === 'client' ? (pathParts[4] ?? 'default') : (pathParts[3] ?? 'default')

  if (
    c.req.method === 'GET' &&
    (pathname === '/api/v1/unsubscribe' || /^\/api\/v1\/lead-magnets\/[^/]+\/asset$/.test(pathname))
  ) {
    await next()
    return
  }

  const client = await requireProductApiClientContext(c)
  if (client instanceof Response) {
    const failedAuthResponse = await failedClientAuthRateLimit(c, endpoint)
    return failedAuthResponse ?? client
  }

  const result = await rateLimitMiddleware(c.env, client.clientId, endpoint)

  c.res.headers.set('X-RateLimit-Remaining', String(result.remaining))
  c.res.headers.set('X-RateLimit-Reset', String(result.resetAt))

  if (!result.allowed) {
    return c.json({ error: 'rate_limit_exceeded', reset_at: result.resetAt }, 429)
  }

  await next()
}

async function failedClientAuthRateLimit(
  c: Context<{ Bindings: Env }>,
  endpoint: string,
): Promise<Response | null> {
  const pathname = new URL(c.req.url).pathname
  if (!pathname.startsWith('/api/client/v1/')) return null

  const product = sanitizeRateLimitPart(c.req.header('X-Sequencer-Product') ?? 'unknown')
  const ip = sanitizeRateLimitPart(
    c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown',
  )
  const result = await rateLimitMiddleware(c.env, `failed-auth:${product}:${ip}`, 'auth-fail')

  if (result.allowed) return null

  return c.json({ error: 'rate_limited' }, 429, {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
    'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
    'X-RateLimit-Endpoint': endpoint,
  })
}

function sanitizeRateLimitPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]/g, '_')
      .slice(0, 128) || 'unknown'
  )
}

// Identity endpoint - reads from Cloudflare Access header
app.route('/me', meRoute)

// Product API (authenticated via CF Access Service Tokens)
app.route('/api/v1/contacts', contactsRoute)
app.route('/api/v1/enrollments', enrollmentsRoute)
app.route('/api/v1/events', eventsRoute)
app.route('/api/v1/unsubscribe', unsubscribeRoute)
app.route('/api/v1/lead-magnets', leadMagnetsRoute)
app.route('/api/v1/lists', listsRoute)
app.route('/api/client/v1/contacts', contactsRoute)
app.route('/api/client/v1/enrollments', enrollmentsRoute)
app.route('/api/client/v1/events', eventsRoute)
app.route('/api/client/v1/unsubscribe', unsubscribeRoute)
app.route('/api/client/v1/lead-magnets', leadMagnetsRoute)
app.route('/api/client/v1/lists', listsRoute)
app.route('/assets/lead-magnets', leadMagnetAssetsRoute)
app.get('/unsubscribe', oneClickUnsubscribe)

// Internal dashboard API (Cloudflare Access protected)
app.route('/api/internal', internalRoute)

// Webhook receivers
app.route('/webhooks/resend', resendWebhookRoute)
app.route('/webhooks/instantly', instantlyWebhookRoute)

// Health check
app.get('/health', (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }))

function sentryOptions(env: Env) {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    release: env.GIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.1 : 1,
  }
}

function cronMonitorSlug(cron: string): string {
  return `sequencer-cron-${cron
    .replace(/\*/g, 'star')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}`
}

async function runQueueWithSentry(batch: MessageBatch, env: Env): Promise<void> {
  try {
    const { queueConsumer } = await import('./queues/consumer')
    return await queueConsumer(batch, env)
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        handler: 'queue',
        queue: batch.queue,
      },
      extra: {
        messageCount: batch.messages.length,
      },
    })
    throw err
  }
}

async function runCronWithSentry(event: ScheduledController, env: Env): Promise<void> {
  try {
    return await Sentry.withMonitor(cronMonitorSlug(event.cron), async () => {
      const { handleCron } = await import('./crons/index')
      return handleCron(event.cron, env)
    })
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        handler: 'scheduled',
        cron: event.cron,
      },
    })
    throw err
  }
}

const worker = {
  fetch: app.fetch.bind(app),
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    return runQueueWithSentry(batch, env)
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCronWithSentry(event, env))
  },
} satisfies ExportedHandler<Env>

const sentryWorker = Sentry.withSentry(sentryOptions, { ...worker }) as ExportedHandler<Env>

export default {
  fetch(request, env, ctx) {
    if (!env.SENTRY_DSN) return worker.fetch(request, env, ctx)
    return sentryWorker.fetch!(request, env, ctx)
  },
  queue(batch, env, ctx) {
    if (!env.SENTRY_DSN || !sentryWorker.queue) return worker.queue(batch, env)
    return sentryWorker.queue(batch, env, ctx)
  },
  scheduled(event, env, ctx) {
    if (!env.SENTRY_DSN || !sentryWorker.scheduled) return worker.scheduled(event, env, ctx)
    return sentryWorker.scheduled(event, env, ctx)
  },
} satisfies ExportedHandler<Env>
