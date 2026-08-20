import { describe, expect, it } from 'vitest'
import { renderGenericNurtureEmail } from './templates/_shared/generic-nurture'
import { leadMagnetContent } from './templates/_shared/lead-magnet-content'
import {
  isResourceNurtureTemplateSlug,
  renderResourceNurtureEmail,
} from './templates/_shared/resource-nurture'

const PROPS = {
  firstName: 'Taylor',
  unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?test=1',
}

const MAGNET_PRODUCTS = Object.keys(leadMagnetContent) as string[]

describe('isResourceNurtureTemplateSlug', () => {
  it('returns true for known resource slugs', () => {
    expect(isResourceNurtureTemplateSlug('nurture/floriva-web-resource')).toBe(true)
  })

  it('returns false for retired product resources', () => {
    expect(isResourceNurtureTemplateSlug('nurture/capveri-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/geoleap-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/lextract-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/boardstack-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/gathergrove-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/kaiplan-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/pebbledesk-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/phiguard-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/skillledger-resource')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/grantpipe-resource')).toBe(false)
  })

  it('returns false for value slugs', () => {
    expect(isResourceNurtureTemplateSlug('nurture/floriva-web-value-2')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/grantpipe-value-1')).toBe(false)
  })

  it('returns false for unknown slugs', () => {
    expect(isResourceNurtureTemplateSlug('onboarding/capveri-welcome')).toBe(false)
    expect(isResourceNurtureTemplateSlug('nurture/unknown-resource')).toBe(false)
  })
})

describe('renderResourceNurtureEmail', () => {
  it('renders for every product that has a lead magnet', async () => {
    for (const product of MAGNET_PRODUCTS) {
      const slug = `nurture/${product}-resource`
      const { html, text } = await renderResourceNurtureEmail(slug, PROPS)
      expect(html.length, `${slug} html`).toBeGreaterThan(100)
      expect(text.length, `${slug} text`).toBeGreaterThan(20)
    }
  }, 60_000)

  it('html contains landingUrl, ctaLabel, and brand name for floriva-web', async () => {
    const { html } = await renderResourceNurtureEmail('nurture/floriva-web-resource', PROPS)
    expect(html).toContain('https://floriva.app/free/period-app-privacy-audit-checklist')
    expect(html).toContain('Get the checklist')
    expect(html).toContain('Floriva')
  })

  it('throws for unknown resource slugs', async () => {
    await expect(renderResourceNurtureEmail('nurture/unknown-resource', PROPS)).rejects.toThrow(
      'Resource nurture template not found',
    )
  })

  it('CTA buttons use pill border-radius (999px)', async () => {
    for (const product of MAGNET_PRODUCTS) {
      const slug = `nurture/${product}-resource`
      const { html } = await renderResourceNurtureEmail(slug, PROPS)
      const radii = [
        ...html.matchAll(/<a\b(?=[^>]*background-color:)[^>]*border-radius:\s*([^;"]+)/g),
      ].map((m) => m[1].trim())
      if (radii.length > 0) {
        expect(radii, `${slug} CTA border-radius`).toEqual(radii.map(() => '999px'))
      }
    }
  }, 60_000)
})

describe('generic-nurture product-specific copy', () => {
  it('nurture/floriva-web-value-2 html contains floriva-specific copy', async () => {
    const { html } = await renderGenericNurtureEmail('nurture/floriva-web-value-2', PROPS)
    expect(html).toContain('Floriva')
    expect(html).toContain('period')
  })

  it('does not render retired GrantPipe nurture templates', async () => {
    await expect(renderGenericNurtureEmail('nurture/grantpipe-value-2', PROPS)).rejects.toThrow(
      'Generic nurture template not found',
    )
  })
})
