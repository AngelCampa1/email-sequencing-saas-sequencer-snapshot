import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildCloudflareQueueMessageRequest,
  loadDlqReplayMessages,
  replayDlqMessages,
} from '../commands/dlq.js'

const validMessage = {
  provider: 'resend',
  event_id: 'evt_1',
  event_type: 'email.delivered',
  message_id: 'msg_1',
  payload: { type: 'email.delivered', data: { email_id: 'msg_1' } },
  received_at: '2026-05-20T12:34:56.789Z',
}

describe('seq dlq replay command helpers', () => {
  it('loads and validates captured queue bodies from pull-style JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seq-dlq-'))
    try {
      const source = join(dir, 'dlq.json')
      await writeFile(
        source,
        JSON.stringify({
          messages: [
            { body: JSON.stringify(validMessage) },
            { body: { ...validMessage, provider: 'instantly', event_id: null, message_id: null } },
          ],
        }),
      )

      const messages = await loadDlqReplayMessages(source)

      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject(validMessage)
      expect(messages[1]).toMatchObject({ provider: 'instantly', event_id: null })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses unknown providers and malformed queue bodies before replay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seq-dlq-'))
    try {
      const source = join(dir, 'dlq.json')
      await writeFile(source, JSON.stringify([{ ...validMessage, provider: 'unknown' }]))

      await expect(loadDlqReplayMessages(source)).rejects.toThrow('Invalid DLQ message at index 0')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('builds Cloudflare Queue push requests that replay through the production queue consumer', () => {
    const request = buildCloudflareQueueMessageRequest({
      accountId: 'a'.repeat(32),
      queueId: 'b'.repeat(32),
      apiToken: 'token',
      message: validMessage,
    })

    expect(request.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/queues/${'b'.repeat(32)}/messages`,
    )
    expect(request.init.method).toBe('POST')
    expect(request.init.headers).toEqual({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(request.init.body))).toEqual({
      body: validMessage,
      content_type: 'json',
    })
  })

  it('supports dry-run without mutating Cloudflare Queues', async () => {
    const fetchMock = vi.fn()

    const result = await replayDlqMessages({
      messages: [validMessage],
      accountId: 'a'.repeat(32),
      queueId: 'b'.repeat(32),
      apiToken: 'token',
      dryRun: true,
      fetchImpl: fetchMock,
    })

    expect(result).toEqual({ replayed: 0, validated: 1, dryRun: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pushes each validated message and fails closed on Cloudflare API errors', async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }))

    const result = await replayDlqMessages({
      messages: [validMessage],
      accountId: 'a'.repeat(32),
      queueId: 'b'.repeat(32),
      apiToken: 'token',
      dryRun: false,
      fetchImpl: fetchMock,
    })

    expect(result).toEqual({ replayed: 1, validated: 1, dryRun: false })
    expect(fetchMock).toHaveBeenCalledOnce()

    fetchMock.mockResolvedValueOnce(
      Response.json({ success: false, errors: [{ message: 'bad queue' }] }, { status: 400 }),
    )
    await expect(
      replayDlqMessages({
        messages: [validMessage],
        accountId: 'a'.repeat(32),
        queueId: 'b'.repeat(32),
        apiToken: 'token',
        dryRun: false,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow('Cloudflare Queue replay failed with 400')
  })
})
