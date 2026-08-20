import { describe, expect, it } from 'vitest'
import { missingRemoteSecretNames, wranglerSecretListArgs } from '../commands/secret-template.js'
import { parseWranglerSecretListOutput } from '../lib/readiness.js'

describe('secret-template command helpers', () => {
  it('builds argv for production secret listing without shell composition', () => {
    expect(wranglerSecretListArgs()).toEqual(['secret', 'list', '--env', 'production'])
  })

  it('filters missing required secrets from Wrangler rows', () => {
    expect(
      missingRemoteSecretNames(
        ['RESEND_WEBHOOK_SECRET', 'INSTANTLY_API_KEY'],
        [{ name: 'RESEND_WEBHOOK_SECRET' }],
      ),
    ).toEqual(['INSTANTLY_API_KEY'])
  })

  it('ignores malformed Wrangler rows when filtering present secrets', () => {
    expect(missingRemoteSecretNames(['RESEND_WEBHOOK_SECRET'], [{ name: 123 }])).toEqual([
      'RESEND_WEBHOOK_SECRET',
    ])
  })

  it('parses Wrangler secret list output even when warnings precede the payload', () => {
    const rows = parseWranglerSecretListOutput(
      [
        'wrangler warning: update available',
        '[not json]',
        JSON.stringify([{ name: 'RESEND_WEBHOOK_SECRET' }]),
      ].join('\n'),
    )

    expect(rows).toEqual([{ name: 'RESEND_WEBHOOK_SECRET' }])
  })

  it('returns an empty secret list for malformed Wrangler secret list output', () => {
    expect(parseWranglerSecretListOutput('wrangler warning only')).toEqual([])
  })
})
