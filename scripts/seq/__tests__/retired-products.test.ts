import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REQUIRED_LEAD_MAGNETS } from '../lib/readiness.js'

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

describe('retired products', () => {
  it('have no source sequence directories or required lead magnet manifest rows', () => {
    for (const product of RETIRED_PRODUCTS) {
      expect(existsSync(join(process.cwd(), 'sequences', product))).toBe(false)
      expect(REQUIRED_LEAD_MAGNETS.map((leadMagnet) => leadMagnet.productSlug)).not.toContain(
        product,
      )
    }
  })

  it('keeps GrantPipe in retirement probes and out of repository recreation sources', () => {
    const root = process.cwd()
    const readinessCommand = readFileSync(
      resolve(root, 'scripts/seq/commands/readiness.ts'),
      'utf8',
    )
    const devSeed = readFileSync(resolve(root, 'scripts/dev/seed-local-contacts.sql'), 'utf8')
    const agentGuide = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
    const claudeGuide = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8')

    expect(readinessCommand).toContain("'prod_grantpipe'")
    expect(devSeed.toLowerCase()).not.toContain('grantpipe')
    expect(agentGuide).not.toContain('camaudit, floriva-web, grantpipe')
    expect(claudeGuide).not.toContain('camaudit, floriva-web, grantpipe')
  })
})
