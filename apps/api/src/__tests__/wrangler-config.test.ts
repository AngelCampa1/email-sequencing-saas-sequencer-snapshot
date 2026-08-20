import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const wranglerToml = readFileSync(join(process.cwd(), 'apps/api/wrangler.toml'), 'utf8')
const cloudflareSetup = readFileSync(join(process.cwd(), 'scripts/setup-cloudflare.mjs'), 'utf8')
// Kept in step with scripts/seq/__tests__/retired-products.test.ts.
const RETIRED_PRODUCTS = [
  'capveri',
  'gathergrove',
  'geoleap',
  'skillledger',
  'kaiplan',
  'lextract',
  'pebbledesk',
  'boardstack',
  'phiguard',
  'grantpipe',
] as const

function runWorkerFirstFor(sectionName: 'assets' | 'env.production.assets'): string[] {
  const escapedSection = sectionName.replaceAll('.', '\\.')
  const sectionPattern = new RegExp(`\\[${escapedSection}\\]([\\s\\S]*?)(?=\\n\\[|$)`)
  const section = sectionPattern.exec(wranglerToml)?.[1] ?? ''
  const arrayMatch = /run_worker_first\s*=\s*\[([^\]]*)\]/.exec(section)
  return (
    arrayMatch?.[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^"|"$/g, ''))
      .filter(Boolean) ?? []
  )
}

describe('wrangler assets routing', () => {
  it('binds the same D1 database and KV namespaces in local and production', () => {
    const placeholders = [
      'database_id = "PLACEHOLDER_D1_DATABASE_ID"',
      'id = "PLACEHOLDER_KV_SUPPRESSIONS_ID"',
      'preview_id = "PLACEHOLDER_KV_SUPPRESSIONS_PREVIEW_ID"',
      'id = "PLACEHOLDER_KV_SESSIONS_ID"',
      'preview_id = "PLACEHOLDER_KV_SESSIONS_PREVIEW_ID"',
    ]

    for (const placeholder of placeholders) {
      // Two occurrences each: the top-level binding and the env.production binding.
      // Anchored on a word boundary so `id = "..._ID"` does not also match `preview_id = "..."`.
      expect(wranglerToml.match(new RegExp(`\\b${placeholder}`, 'g'))).toHaveLength(2)
    }
  })

  it('never commits real Cloudflare resource identifiers', () => {
    // Real identifiers are supplied out of band at deploy time; the committed config
    // only ever carries PLACEHOLDER_* tokens. See scripts/setup-cloudflare.mjs.
    //
    // The guard matches on the shape of the *value*, not on the key. Keying off
    // `database_id` / `id` / `preview_id` would miss the identifier most likely to
    // be pasted back in by accident: `account_id`, which is also 32 hex characters.
    // Anything Cloudflare hands out is a 32-hex id, a 64-hex Access audience tag, or
    // a dashed UUID, so a new binding added later is covered without touching this.
    const cloudflareIdentifier =
      /=\s*"(?:[0-9a-f]{32}|[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/
    expect(wranglerToml).not.toMatch(cloudflareIdentifier)

    // Positive assertions, so deleting a line cannot silently pass the guard above.
    expect(wranglerToml).toContain('CF_ACCESS_TEAM_NAME = "PLACEHOLDER_CF_ACCESS_TEAM_NAME"')
    expect(wranglerToml).toContain('CF_ACCESS_AUD = "PLACEHOLDER_CF_ACCESS_AUD"')
  })

  it('routes tokenized lead magnet assets through the Worker in local and production assets configs', () => {
    expect(runWorkerFirstFor('assets')).toContain('/assets/lead-magnets/*')
    expect(runWorkerFirstFor('env.production.assets')).toContain('/assets/lead-magnets/*')
  })

  it('routes public one-click unsubscribe links through the Worker in local and production assets configs', () => {
    expect(runWorkerFirstFor('assets')).toContain('/unsubscribe')
    expect(runWorkerFirstFor('env.production.assets')).toContain('/unsubscribe')
  })

  it('does not bind retired product lead magnet buckets or Resend secret hints', () => {
    for (const product of RETIRED_PRODUCTS) {
      const envName = product.replace(/-/g, '_').toUpperCase()
      expect(wranglerToml).not.toContain(`${envName}_LEAD_MAGNETS`)
      expect(wranglerToml).not.toContain(`${product}-lead-magnets`)
      expect(wranglerToml).not.toContain(`RESEND_API_KEY_${envName}`)
    }
    expect(wranglerToml).not.toContain('GRANTPIPE_DOCUMENTS')
    expect(wranglerToml).not.toContain('grantpipe-documents')
    expect(wranglerToml).not.toContain('SEQUENCER_CLIENT_SECRET_GRANTPIPE')
    expect(cloudflareSetup).not.toContain('grantpipe-documents')
  })
})
