import { readFile } from 'node:fs/promises'
import { Command } from 'commander'

type QueueProvider = 'resend' | 'instantly'

export interface DlqReplayMessage {
  provider: QueueProvider
  event_id?: string | null
  event_type: string
  message_id: string | null
  payload: unknown
  received_at?: string
}

export interface ReplayResult {
  validated: number
  replayed: number
  dryRun: boolean
}

export interface ReplayOptions {
  messages: DlqReplayMessage[]
  accountId: string
  queueId: string
  apiToken: string
  dryRun: boolean
  fetchImpl?: typeof fetch
}

export const dlqCommand = new Command('dlq')
  .description('Dead-letter queue recovery tools')
  .addCommand(
    new Command('replay')
      .description('Validate captured DLQ messages and push them back to events-queue')
      .requiredOption(
        '--source <file>',
        'JSON file containing queue messages or a Cloudflare pull response',
      )
      .requiredOption('--account-id <id>', 'Cloudflare account id')
      .requiredOption('--queue-id <id>', 'Cloudflare events-queue id')
      .option(
        '--api-token-env <name>',
        'Environment variable containing a Cloudflare API token',
        'CLOUDFLARE_API_TOKEN',
      )
      .option('--dry-run', 'Validate only; do not push messages', false)
      .action(async (opts) => {
        const messages = await loadDlqReplayMessages(opts.source)
        const apiToken = process.env[opts.apiTokenEnv]
        if (!opts.dryRun && !apiToken) {
          throw new Error(`Missing Cloudflare API token env var: ${opts.apiTokenEnv}`)
        }
        const result = await replayDlqMessages({
          messages,
          accountId: opts.accountId,
          queueId: opts.queueId,
          apiToken: apiToken ?? 'dry-run',
          dryRun: Boolean(opts.dryRun),
        })
        const action = result.dryRun ? 'validated' : 'replayed'
        console.log(
          `DLQ replay ${action}: ${result.validated} validated, ${result.replayed} replayed`,
        )
      }),
  )

export async function loadDlqReplayMessages(sourceFile: string): Promise<DlqReplayMessage[]> {
  const raw = await readFile(sourceFile, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`DLQ source is not valid JSON: ${(error as Error).message}`)
  }
  return extractDlqReplayMessages(parsed)
}

export function extractDlqReplayMessages(source: unknown): DlqReplayMessage[] {
  const candidates = Array.isArray(source)
    ? source
    : isRecord(source) && Array.isArray(source.messages)
      ? source.messages
      : [source]

  return candidates.map((candidate, index) => {
    const unwrapped = unwrapQueueBody(candidate)
    if (!isDlqReplayMessage(unwrapped)) {
      throw new Error(`Invalid DLQ message at index ${index}`)
    }
    return unwrapped
  })
}

export function buildCloudflareQueueMessageRequest(input: {
  accountId: string
  queueId: string
  apiToken: string
  message: DlqReplayMessage
}): { url: string; init: RequestInit } {
  assertCloudflareResourceId(input.accountId, 'account id')
  assertCloudflareResourceId(input.queueId, 'queue id')
  const url = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/queues/${input.queueId}/messages`
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: input.message,
        content_type: 'json',
      }),
    },
  }
}

export async function replayDlqMessages(options: ReplayOptions): Promise<ReplayResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  if (options.dryRun) {
    return { validated: options.messages.length, replayed: 0, dryRun: true }
  }

  let replayed = 0
  for (const message of options.messages) {
    const request = buildCloudflareQueueMessageRequest({
      accountId: options.accountId,
      queueId: options.queueId,
      apiToken: options.apiToken,
      message,
    })
    const response = await fetchImpl(request.url, request.init)
    const responseText = await response.text()
    let responseBody: unknown = null
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText)
      } catch {
        responseBody = responseText
      }
    }
    if (!response.ok || !cloudflareApiSucceeded(responseBody)) {
      throw new Error(
        `Cloudflare Queue replay failed with ${response.status}: ${formatCloudflareError(responseBody)}`,
      )
    }
    replayed += 1
  }

  return { validated: options.messages.length, replayed, dryRun: false }
}

function unwrapQueueBody(candidate: unknown): unknown {
  const body = isRecord(candidate) && Object.hasOwn(candidate, 'body') ? candidate.body : candidate
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function isDlqReplayMessage(value: unknown): value is DlqReplayMessage {
  if (!isRecord(value)) return false
  if (value.provider !== 'resend' && value.provider !== 'instantly') return false
  if (typeof value.event_type !== 'string' || value.event_type.trim() === '') return false
  if (value.event_id !== undefined && value.event_id !== null && typeof value.event_id !== 'string')
    return false
  if (value.message_id !== null && typeof value.message_id !== 'string') return false
  if (!Object.hasOwn(value, 'payload') || value.payload === undefined) return false
  if (value.received_at !== undefined && typeof value.received_at !== 'string') return false
  return true
}

function assertCloudflareResourceId(value: string, label: string): void {
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`Invalid Cloudflare ${label}`)
  }
}

function cloudflareApiSucceeded(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.success === true
}

function formatCloudflareError(value: unknown): string {
  if (!isRecord(value)) return typeof value === 'string' ? value : 'unexpected response'
  if (Array.isArray(value.errors) && value.errors.length > 0) {
    return value.errors
      .map((error) =>
        isRecord(error) && typeof error.message === 'string'
          ? error.message
          : JSON.stringify(error),
      )
      .join('; ')
  }
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
