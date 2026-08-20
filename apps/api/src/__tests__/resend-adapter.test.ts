import { afterEach, describe, expect, it, vi } from 'vitest'

function env() {
  return {
    ENVIRONMENT: 'test',
    GIT_SHA: 'test',
  }
}

describe('ResendAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exports ResendAdapter and createResendAdapter', async () => {
    const mod = await import('../providers/resend')
    expect(typeof mod.ResendAdapter).toBe('function')
    expect(typeof mod.createResendAdapter).toBe('function')
    expect(typeof mod.getResendApiKey).toBe('function')
  })

  it('ResendError has statusCode property', async () => {
    const { ResendError } = await import('../providers/resend')
    const err = new ResendError('test', 429)
    expect(err.statusCode).toBe(429)
    expect(err.name).toBe('ResendError')
  })

  it('getResendApiKey maps product slug to env key', async () => {
    const { getResendApiKey } = await import('../providers/resend')
    const fakeEnv = {
      RESEND_API_KEY_CAMAUDIT: 'key_123',
      RESEND_API_KEY_FLORIVA_WEB: 'key_floriva',
    } as any
    expect(getResendApiKey(fakeEnv, 'camaudit')).toBe('key_123')
    expect(getResendApiKey(fakeEnv, 'floriva-web')).toBe('key_floriva')
    expect(getResendApiKey(fakeEnv, 'unknown-product')).toBeUndefined()
  })

  it('getResendApiKey uses an explicitly configured secret name when provided', async () => {
    const { getResendApiKey } = await import('../providers/resend')
    const fakeEnv = {
      RESEND_API_KEY_CAMAUDIT: 'old_key',
      RESEND_API_KEY_CAMAUDIT_ROTATED: 'rotated_key',
    } as never

    expect(getResendApiKey(fakeEnv, 'camaudit', 'RESEND_API_KEY_CAMAUDIT_ROTATED')).toBe(
      'rotated_key',
    )
  })

  it('throws when a successful send response is missing a string message id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({})),
    )
    const { ResendAdapter } = await import('../providers/resend')
    const adapter = new ResendAdapter('resend-key', env() as never)

    await expect(
      adapter.send({
        to: 'user@example.com',
        from: 'hello@example.com',
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
      }),
    ).rejects.toThrow('Resend send returned an unexpected payload shape')
  })

  it('throws when a successful send response is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    )
    const { ResendAdapter } = await import('../providers/resend')
    const adapter = new ResendAdapter('resend-key', env() as never)

    await expect(
      adapter.send({
        to: 'user@example.com',
        from: 'hello@example.com',
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
      }),
    ).rejects.toThrow('Resend send returned an unexpected payload shape')
  })

  it('sends a Resend idempotency key header when provided', async () => {
    const fetch = vi.fn(async () => Response.json({ id: 'msg_1' }))
    vi.stubGlobal('fetch', fetch)
    const { ResendAdapter } = await import('../providers/resend')
    const adapter = new ResendAdapter('resend-key', env() as never)

    await adapter.send({
      to: 'user@example.com',
      from: 'hello@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      idempotencyKey: 'sequencer:run_1:0:step_1',
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'sequencer:run_1:0:step_1',
        }),
      }),
    )
  })
})
