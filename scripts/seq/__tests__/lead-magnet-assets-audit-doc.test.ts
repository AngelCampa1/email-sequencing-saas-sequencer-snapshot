import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REQUIRED_LEAD_MAGNETS } from '../lib/readiness.js'

describe('lead magnet product assets audit documentation', () => {
  it('keeps Sequencer-managed product cutover status aligned with the lead magnet manifest', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const audit = readFileSync(
      resolve(repoRoot, 'docs/live-product-sequencer-cutover-audit.md'),
      'utf8',
    )
    // Active products that still use the shared `{product}-lead-magnet-nurture` slug.
    const sequencerManagedProducts = ['floriva-web'] as const

    for (const productSlug of sequencerManagedProducts) {
      expect(
        REQUIRED_LEAD_MAGNETS.some(
          (leadMagnet) =>
            leadMagnet.productSlug === productSlug &&
            leadMagnet.fulfillmentOwner === 'sequencer' &&
            leadMagnet.fulfillmentSequenceSlug === `${productSlug}-lead-magnet-nurture`,
        ),
      ).toBe(true)
      expect(audit).not.toContain(`| \`${productSlug}\` | Partial |`)
      expect(audit).toMatch(
        new RegExp(
          `\\| \`${productSlug}\` \\| [^|]+ \\| .*Sequencer-managed lead-magnet downloads use product-owned R2 assets and enroll \`${productSlug}-lead-magnet-nurture\``,
        ),
      )
    }

    expect(audit).toContain('Sequencer-managed lead-magnet downloads use product-owned R2 assets')
    expect(audit).not.toMatch(/should be classified(?: as [^.;|]+)? or moved separately/)
    expect(audit).not.toContain('should be classified as fulfillment or moved separately')
    expect(audit).not.toContain(
      'Immediate lead-magnet welcome/resource delivery still sends locally through Resend',
    )
    expect(audit).not.toContain(
      'immediate lead-magnet delivery and signup confirmation still send locally through Resend',
    )
  })

  it('describes rollout seed SQL as all Sequencer-managed lead magnet rows', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const audit = readFileSync(resolve(repoRoot, 'docs/product-rollout-audit.md'), 'utf8')

    expect(audit).toMatch(/writes the required\s+Sequencer-managed lead-magnet row SQL/)
    expect(audit).toContain('Required Sequencer-managed lead-magnet rows are active')
    expect(audit).toContain('Required Sequencer-managed lead-magnet R2 assets exist')
    expect(audit).toContain('inserted/updated the active Sequencer-managed lead-magnet rows')
    expect(audit).toMatch(/Product-owned dynamic flows must serve the asset in the product app/)
    expect(audit).toMatch(/call `enroll` instead of\s+`downloadLeadMagnet`/)

    expect(audit).not.toContain('Required CAMAudit lead-magnet row')
    expect(audit).not.toContain('Required CAMAudit lead-magnet R2 asset')
    expect(audit).not.toContain('writes the required CAMAudit lead-magnet seed row SQL')
    expect(audit).not.toContain('inserted/updated the active CAMAudit lead-magnet row')
  })

  it('states the current required lead magnet count for each product in the manifest', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const audit = readFileSync(
      resolve(repoRoot, 'docs/lead-magnet-product-assets-audit.md'),
      'utf8',
    )
    const counts = new Map<string, number>()

    for (const leadMagnet of REQUIRED_LEAD_MAGNETS) {
      counts.set(leadMagnet.productSlug, (counts.get(leadMagnet.productSlug) ?? 0) + 1)
    }

    for (const [productSlug, count] of [...counts.entries()].sort()) {
      expect(audit).toContain(
        `Sequencer currently requires ${count} row${count === 1 ? '' : 's'} for \`${productSlug}\`.`,
      )
    }

    expect(audit).not.toContain('Sequencer currently requires 1.')
  })

  it('keeps simple product asset catalog counts aligned with current manifest rows', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const audit = readFileSync(
      resolve(repoRoot, 'docs/lead-magnet-product-assets-audit.md'),
      'utf8',
    )
    const counts = new Map<string, number>()

    for (const leadMagnet of REQUIRED_LEAD_MAGNETS) {
      counts.set(leadMagnet.productSlug, (counts.get(leadMagnet.productSlug) ?? 0) + 1)
    }

    const productRows = [
      ['CAMAudit', 'camaudit'],
      ['Floriva', 'floriva-web'],
    ] as const

    for (const [label, productSlug] of productRows) {
      const count = counts.get(productSlug)
      expect(count).toBeGreaterThan(0)
      expect(audit).toContain(`| ${label} | ${count} `)
    }
  })
})
