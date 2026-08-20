import { describe, expect, it } from 'vitest'

describe('webhook handlers export correct routes', () => {
  it('resend webhook route is exported', async () => {
    const { resendWebhookRoute } = await import('../webhooks/resend')
    expect(resendWebhookRoute).toBeDefined()
  })

  it('instantly webhook route is exported', async () => {
    const { instantlyWebhookRoute } = await import('../webhooks/instantly')
    expect(instantlyWebhookRoute).toBeDefined()
  })
})

describe('queue consumer', () => {
  it('exports queueConsumer function', async () => {
    const { queueConsumer } = await import('../queues/consumer')
    expect(typeof queueConsumer).toBe('function')
  })
})
