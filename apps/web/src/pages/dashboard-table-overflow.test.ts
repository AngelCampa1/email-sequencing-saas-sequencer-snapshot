import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tablePages = [
  'SequencesPage.tsx',
  'LeadMagnetsPage.tsx',
  'TemplatesPage.tsx',
  'SuppressionsPage.tsx',
  'SettingsPage.tsx',
  'DeliverabilityPage.tsx',
  'OverviewPage.tsx',
]

function sourceFor(page: string) {
  return readFileSync(fileURLToPath(new URL(`./${page}`, import.meta.url)), 'utf8')
}

function tableOffsets(source: string) {
  return [...source.matchAll(/<table\b/g)].map((match) => match.index ?? 0)
}

describe('dashboard table overflow wrappers', () => {
  it.each(tablePages)('%s wraps every table in horizontal overflow protection', (page) => {
    const source = sourceFor(page)
    const missingWrapper = tableOffsets(source).filter((offset) => {
      const precedingMarkup = source.slice(Math.max(0, offset - 180), offset)
      return !precedingMarkup.includes('overflow-x-auto')
    })

    expect(missingWrapper).toEqual([])
  })
})
