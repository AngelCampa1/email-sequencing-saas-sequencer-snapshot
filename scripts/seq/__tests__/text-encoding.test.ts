import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

const checkedFiles = [
  'apps/api/src/crons/index.ts',
  'apps/web/src/pages/ContactsPage.tsx',
  'docs/api/README.md',
  'docs/api/curl-examples.md',
]

describe('text encoding hygiene', () => {
  it('keeps operational source and docs free of mojibake markers and decorative separators', () => {
    for (const file of checkedFiles) {
      const contents = readFileSync(resolve(repoRoot, file), 'utf8')

      expect(contents, file).not.toMatch(/[\u00e2\u00c2\ufffd\u00b7\u2014\u2192\u2500-\u257f]/u)
    }
  })
})
