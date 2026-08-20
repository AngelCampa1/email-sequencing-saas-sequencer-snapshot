import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

describe('production config docs', () => {
  it('uses the workspace-local wrangler invocation for bulk secret upload', () => {
    const docs = readFileSync(resolve(repoRoot, 'docs/production-config-values.md'), 'utf8')

    expect(docs).toContain(
      'pnpm exec wrangler secret bulk ../../dist/production-secrets.template.json --env production',
    )
    expect(docs).not.toContain(
      '\nwrangler secret bulk ../../dist/production-secrets.template.json --env production',
    )
  })
})
