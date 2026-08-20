import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('workspace package scripts', () => {
  it('keeps the Worker runtime system harness in the root release test path', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const scripts = rootPackage.scripts ?? {}

    expect(scripts['test:system']).toBe('vitest run --config vitest.system.config.ts')
    expect(scripts['test:all']).toBe('pnpm test && pnpm test:system')
  })

  it('includes the API Worker runtime typecheck in the root build', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const apiPackage = JSON.parse(
      readFileSync(resolve(repoRoot, 'apps/api/package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>
    }
    const scripts = apiPackage.scripts ?? {}

    expect(scripts.build).toBe('tsc -p tsconfig.build.json --noEmit')
  })

  it('routes API deploys through the guarded root production deploy flow', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const apiPackage = JSON.parse(
      readFileSync(resolve(repoRoot, 'apps/api/package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>
    }
    const scripts = apiPackage.scripts ?? {}

    expect(scripts.deploy).toBe('pnpm -w deploy:prod')
    expect(scripts).not.toHaveProperty('deploy:raw')
    expect(scripts).not.toHaveProperty('deploy:prod:raw')

    const deployScripts = Object.fromEntries(
      Object.entries(scripts).filter(([name]) => name.startsWith('deploy')),
    )
    expect(deployScripts).toEqual({ deploy: 'pnpm -w deploy:prod' })
  })
})
