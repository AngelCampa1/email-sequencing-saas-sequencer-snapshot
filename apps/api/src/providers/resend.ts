import { createLogger } from '../lib/observability'
import type { Env } from '../types'

export interface SendEmailOptions {
  to: string
  from: string
  replyTo?: string
  subject: string
  html: string
  text: string
  idempotencyKey?: string
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
}

export interface SendEmailResult {
  id: string
}

export class ResendAdapter {
  private apiKey: string
  private logger: ReturnType<typeof createLogger>

  constructor(
    apiKey: string,
    private env: Env,
  ) {
    this.apiKey = apiKey
    this.logger = createLogger(env, { provider: 'resend' })
  }

  async send(opts: SendEmailOptions): Promise<SendEmailResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        to: opts.to,
        from: opts.from,
        reply_to: opts.replyTo,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        headers: opts.headers,
        tags: opts.tags,
      }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ name: 'unknown', message: res.statusText }))
      this.logger.error('Resend send failed', {
        status: res.status,
        error: (error as any).message ?? String(error),
      })
      throw new ResendError(
        `Resend send failed: ${(error as any).message ?? res.statusText}`,
        res.status,
      )
    }

    const result = parseSendEmailResult(await readSendResponseJson(res))
    this.logger.info('Email sent', { resend_message_id: result.id, to: opts.to })
    // Note: send.sent is tracked at the DO layer with real dims.
    return result
  }
}

export class ResendError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ResendError'
  }
}

export function getResendApiKey(
  env: Env,
  productSlug: string,
  secretName?: string,
): string | undefined {
  if (secretName) {
    return env[secretName as keyof typeof env] as string | undefined
  }
  const secretSuffix = productSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const key = `RESEND_API_KEY_${secretSuffix}` as keyof typeof env
  return env[key] as string | undefined
}

export function createResendAdapter(
  env: Env,
  productSlug: string,
  secretName?: string,
): ResendAdapter {
  const apiKey = getResendApiKey(env, productSlug, secretName)
  if (!apiKey) {
    const secretSuffix = productSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    const expectedSecretName = secretName ?? `RESEND_API_KEY_${secretSuffix}`
    throw new Error(
      `No Resend API key for product: ${productSlug}. Set ${expectedSecretName} secret.`,
    )
  }
  return new ResendAdapter(apiKey, env)
}

async function readSendResponseJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw new ResendError('Resend send returned an unexpected payload shape', 502)
  }
}

function parseSendEmailResult(data: unknown): SendEmailResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ResendError('Resend send returned an unexpected payload shape', 502)
  }

  const id = (data as { id?: unknown }).id
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ResendError('Resend send returned an unexpected payload shape', 502)
  }

  return { id }
}
