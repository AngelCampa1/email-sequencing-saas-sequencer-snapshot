import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Cloudflare setup helper', () => {
  it('creates every R2 bucket bound by wrangler.toml', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const wranglerToml = readFileSync(resolve(repoRoot, 'apps/api/wrangler.toml'), 'utf8')
    const setupCloudflare = readFileSync(resolve(repoRoot, 'scripts/setup-cloudflare.mjs'), 'utf8')
    const boundBucketNames = Array.from(
      new Set(
        Array.from(wranglerToml.matchAll(/(?:preview_)?bucket_name\s*=\s*"([^"]+)"/g)).map(
          (match) => match[1],
        ),
      ),
    ).sort()

    expect(boundBucketNames.length).toBeGreaterThan(0)
    for (const bucketName of boundBucketNames) {
      expect(setupCloudflare).toContain(`pnpm exec wrangler r2 bucket create ${bucketName}`)
    }
  })
})
