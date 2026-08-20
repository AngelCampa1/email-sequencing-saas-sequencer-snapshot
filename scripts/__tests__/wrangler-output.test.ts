import { describe, expect, it } from 'vitest'
import { parseWranglerSecretListOutput } from '../lib/wrangler-output.mjs'

describe('Wrangler output helpers', () => {
  it('parses secret list output even when warnings precede the JSON payload', () => {
    const rows = parseWranglerSecretListOutput(
      [
        'wrangler warning: update available',
        '[not json]',
        JSON.stringify([{ name: 'RESEND_WEBHOOK_SECRET' }]),
      ].join('\n'),
    )

    expect(rows).toEqual([{ name: 'RESEND_WEBHOOK_SECRET' }])
  })

  it('returns an empty secret list for malformed output', () => {
    expect(parseWranglerSecretListOutput('wrangler warning only')).toEqual([])
  })
})
