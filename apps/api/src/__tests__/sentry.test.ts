import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
const withMonitor = vi.fn((_name, callback) => callback())
const withSentry = vi.fn((_options, handler) => handler)

vi.mock('@sentry/cloudflare', () => ({
  captureException,
  withMonitor,
  withSentry,
}))

const emptyRoute = { routes: [] }

vi.mock('../routes/me', () => ({ meRoute: emptyRoute }))
vi.mock('../routes/api/v1/contacts', () => ({ contactsRoute: emptyRoute }))
vi.mock('../routes/api/v1/enrollments', () => ({ enrollmentsRoute: emptyRoute }))
vi.mock('../routes/api/v1/events', () => ({ eventsRoute: emptyRoute }))
vi.mock('../routes/api/v1/unsubscribe', () => ({
  oneClickUnsubscribe: vi.fn(),
  unsubscribeRoute: emptyRoute,
}))
vi.mock('../routes/api/v1/lead-magnets', () => ({
  leadMagnetAssetsRoute: emptyRoute,
  leadMagnetsRoute: emptyRoute,
}))
vi.mock('../webhooks/resend', () => ({ resendWebhookRoute: emptyRoute }))
vi.mock('../webhooks/instantly', () => ({ instantlyWebhookRoute: emptyRoute }))
vi.mock('../durable-objects/sequence-run', () => ({ SequenceRunDO: class SequenceRunDO {} }))
vi.mock('../routes/internal/index', () => ({ internalRoute: emptyRoute }))
vi.mock('../middleware/rate-limit', () => ({ rateLimitMiddleware: vi.fn() }))
vi.mock('../lib/product-api-auth', () => ({ getProductApiClientId: vi.fn() }))

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'sha_test',
    ...overrides,
  }
}

describe('Sentry Cloudflare integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('wraps the module Worker with environment-specific options from bindings', async () => {
    const mod = await import('../index')

    expect(withSentry).toHaveBeenCalledOnce()
    expect(mod.default.fetch).toBeTypeOf('function')
    expect(mod.default.queue).toBeTypeOf('function')
    expect(mod.default.scheduled).toBeTypeOf('function')

    const [optionsFactory] = withSentry.mock.calls[0]
    expect(
      optionsFactory(
        baseEnv({
          ENVIRONMENT: 'production',
          GIT_SHA: 'abc123',
          SENTRY_DSN: 'https://dsn.example/1',
        }),
      ),
    ).toMatchObject({
      dsn: 'https://dsn.example/1',
      environment: 'production',
      release: 'abc123',
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    })
    expect(optionsFactory(baseEnv())).toMatchObject({
      dsn: undefined,
      environment: 'test',
      release: 'sha_test',
      sendDefaultPii: false,
      tracesSampleRate: 1,
    })
  })

  it('routes queue and scheduled handlers through the Sentry-wrapped worker when configured', async () => {
    const wrappedQueue = vi.fn()
    const wrappedScheduled = vi.fn()
    withSentry.mockImplementationOnce((_options, handler) => ({
      ...handler,
      queue: wrappedQueue,
      scheduled: wrappedScheduled,
    }))
    const mod = await import('../index')
    const env = baseEnv({ SENTRY_DSN: 'https://dsn.example/1' })
    const ctx = { waitUntil: vi.fn() }

    await mod.default.queue(
      { queue: 'events-queue', messages: [] } as never,
      env as never,
      ctx as never,
    )
    await mod.default.scheduled(
      { cron: '0 3 * * *' } as ScheduledController,
      env as never,
      ctx as never,
    )

    expect(wrappedQueue).toHaveBeenCalledOnce()
    expect(wrappedScheduled).toHaveBeenCalledOnce()
  })

  it('captures and rethrows queue handler failures with queue context', async () => {
    vi.doMock('../queues/consumer', () => ({
      queueConsumer: vi.fn(async () => {
        throw new Error('queue failed')
      }),
    }))
    const mod = await import('../index')

    await expect(
      mod.default.queue(
        { queue: 'events-queue', messages: [] } as never,
        baseEnv() as never,
        {} as never,
      ),
    ).rejects.toThrow('queue failed')

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: {
        handler: 'queue',
        queue: 'events-queue',
      },
      extra: {
        messageCount: 0,
      },
    })
  })

  it('monitors scheduled crons and captures cron failures', async () => {
    withMonitor.mockImplementationOnce(async () => {
      throw new Error('cron failed')
    })
    const waitUntil = vi.fn((promise: Promise<void>) => promise.catch(() => undefined))
    const mod = await import('../index')

    await mod.default.scheduled(
      { cron: '0 3 * * *' } as ScheduledController,
      baseEnv() as never,
      { waitUntil } as never,
    )

    expect(withMonitor).toHaveBeenCalledWith(
      'sequencer-cron-0-3-star-star-star',
      expect.any(Function),
    )
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: {
        handler: 'scheduled',
        cron: '0 3 * * *',
      },
    })
  })
})
