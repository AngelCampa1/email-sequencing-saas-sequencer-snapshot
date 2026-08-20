import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('vitest workspace configuration', () => {
  it('excludes local git worktrees from test discovery', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const source = readFileSync(resolve(repoRoot, 'vitest.config.ts'), 'utf8')

    expect(source).toContain("'.worktrees/**'")
  })
})
