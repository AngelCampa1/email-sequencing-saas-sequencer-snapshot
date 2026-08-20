import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const routeFiles = ['contacts.ts', 'enrollments.ts', 'lead-magnets.ts']

describe('contact product membership inserts', () => {
  it.each(routeFiles)('%s ignores concurrent duplicate membership inserts', (fileName) => {
    const source = readFileSync(join(process.cwd(), 'apps/api/src/routes/api/v1', fileName), 'utf8')

    expect(source).not.toMatch(/insert\(contact_products\)\.values\([^)]*\)\s*$/m)
    expect(source).toMatch(
      /insert\(contact_products\)[\s\S]*?\.values\([\s\S]*?\)[\s\S]*?\.onConflictDoNothing\(\)/,
    )
  })
})
