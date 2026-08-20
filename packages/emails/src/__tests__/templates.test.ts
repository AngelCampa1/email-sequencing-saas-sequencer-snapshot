import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { productBranding } from '../branding'

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

const BASE_PROPS = {
  unsubscribeUrl: 'https://example.com/unsubscribe',
  firstName: 'Test',
}

const PRODUCT_BRANDS = {
  camaudit: {
    name: 'CAMAudit',
    color: '#1e40af',
    logoUrl: 'https://sequencer.ventoralabs.com/email-logos/camaudit.png?v=20260514-official',
  },
  'floriva-web': {
    name: 'Floriva',
    color: '#15803d',
    logoUrl: 'https://sequencer.ventoralabs.com/email-logos/floriva-web.png?v=20260514-official',
  },
} as const

const OFFICIAL_EMAIL_LOGO_HASHES = {
  camaudit: 'F931383A11F9A6CF05A403921CCCBFD45C7CEE8F9682569593F73F0DAA542030',
  'floriva-web': '27D8130C737FB00A4EE2EDA6FD768D3835115B645B8B9A248BF7A3A905A59E17',
} as const

function extractButtonRadii(html: string) {
  return [...html.matchAll(/<a\b(?=[^>]*background-color:)[^>]*border-radius:\s*([^;"]+)/g)].map(
    (match) => match[1].trim(),
  )
}

describe('Email templates render without throwing', () => {
  it('camaudit fulfillment renders', async () => {
    const mod = await import('../templates/camaudit/fulfillment-tenant-checklist')
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text.length).toBeGreaterThan(10)
  })

  it('camaudit nurture renders', async () => {
    const mod = await import('../templates/camaudit/nurture-value-1')
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text.length).toBeGreaterThan(10)
  })

  it('camaudit case study renders', async () => {
    const mod = await import('../templates/camaudit/nurture-case-study')
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text).toContain('case study')
  })

  it('camaudit soft demo renders', async () => {
    const mod = await import('../templates/camaudit/nurture-book-demo-soft')
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text).toContain('demo')
  })

  it('camaudit direct demo renders', async () => {
    const mod = await import('../templates/camaudit/nurture-book-demo-direct')
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text).toContain('Book a demo')
  })

  const liveProductTemplates = {
    'floriva-web': {
      fulfillment: () => import('../templates/floriva-web/fulfillment-welcome'),
      nurture: () => import('../templates/floriva-web/nurture-value-1'),
    },
  }

  it.each(
    Object.entries(liveProductTemplates),
  )('%s fulfillment renders', async (_product, loaders) => {
    const mod = await loaders.fulfillment()
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text.length).toBeGreaterThan(10)
  })

  it.each(Object.entries(liveProductTemplates))('%s nurture renders', async (_product, loaders) => {
    const mod = await loaders.nurture()
    const { html, text } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('<!DOCTYPE html')
    expect(text.length).toBeGreaterThan(10)
  })

  it('defines complete app branding for every sequenced product', () => {
    expect(productBranding).toEqual(PRODUCT_BRANDS)
    for (const product of RETIRED_PRODUCTS) {
      expect(productBranding).not.toHaveProperty(product)
    }
  })

  it('defines a hosted email logo for every sequenced product', () => {
    for (const [slug, brand] of Object.entries(productBranding)) {
      expect(brand.logoUrl, `${slug} logo`).toContain(
        `https://sequencer.ventoralabs.com/email-logos/${slug}.png`,
      )
      expect(brand.logoUrl, `${slug} official logo cache key`).toContain('v=20260514-official')
    }
  })

  it('uses official product email logo assets where source assets exist', () => {
    for (const [slug, expectedHash] of Object.entries(OFFICIAL_EMAIL_LOGO_HASHES)) {
      const asset = readFileSync(join(process.cwd(), `apps/web/public/email-logos/${slug}.png`))
      const hash = createHash('sha256').update(asset).digest('hex').toUpperCase()
      expect(hash, `${slug} logo`).toBe(expectedHash)
    }
  })

  it('uses app brand colors in seeded product records', () => {
    const migration = readFileSync(
      join(process.cwd(), 'packages/db/migrations/0001_seed_products.sql'),
      'utf8',
    )
    for (const [slug, brand] of Object.entries(PRODUCT_BRANDS)) {
      expect(migration, `${slug} seed row`).toContain(`'${slug}'`)
      expect(migration, `${slug} brand color`).toContain(`'${brand.color}'`)
    }
  })

  it('keeps CAMAudit fulfillment links on the CAMAudit domain', async () => {
    const mod = await import('../templates/camaudit/fulfillment-tenant-checklist')
    const { html } = await mod.renderEmail(BASE_PROPS)
    expect(html).toContain('https://camaudit.io/tools/cam-pre-send-packet-checklist-download')
    expect(html).not.toContain('capveri.com/tools/cam-pre-send-packet-checklist-download')
  })

  it('renders every non-legacy CTA as a pill', async () => {
    const templateLoaders = [
      () => import('../templates/camaudit/fulfillment-tenant-checklist'),
      () => import('../templates/camaudit/nurture-book-demo-soft'),
      () => import('../templates/camaudit/nurture-book-demo-direct'),
      ...Object.values(liveProductTemplates).map((loaders) => loaders.fulfillment),
    ]

    for (const loadTemplate of templateLoaders) {
      const mod = await loadTemplate()
      const { html } = await mod.renderEmail(BASE_PROPS)
      const radii = extractButtonRadii(html)
      expect(radii.length, 'CTA count').toBeGreaterThan(0)
      expect(radii).toEqual(radii.map(() => '999px'))
    }
  })

  it('renders every non-legacy email with a branded logo image', async () => {
    const templateLoaders = [
      {
        product: 'camaudit',
        load: () => import('../templates/camaudit/fulfillment-tenant-checklist'),
      },
      { product: 'camaudit', load: () => import('../templates/camaudit/nurture-value-1') },
      { product: 'camaudit', load: () => import('../templates/camaudit/nurture-case-study') },
      { product: 'camaudit', load: () => import('../templates/camaudit/nurture-book-demo-soft') },
      { product: 'camaudit', load: () => import('../templates/camaudit/nurture-book-demo-direct') },
      ...Object.entries(liveProductTemplates).flatMap(([product, loaders]) => [
        { product, load: loaders.fulfillment },
        { product, load: loaders.nurture },
      ]),
    ] as const

    for (const { product, load } of templateLoaders) {
      const brand = PRODUCT_BRANDS[product as keyof typeof PRODUCT_BRANDS]
      const mod = await load()
      const { html } = await mod.renderEmail(BASE_PROPS)
      expect(html, `${product} logo image`).toContain(`src="${brand.logoUrl}"`)
      expect(html, `${product} logo alt`).toContain(`alt="${brand.name}"`)
    }
  })
})

describe('template catalog', () => {
  it('recognizes CAMAudit legacy templates without accepting retired GrantPipe templates', async () => {
    const { isKnownSequencerTemplateSlug } = await import('../template-catalog')

    expect(isKnownSequencerTemplateSlug('legacy/camaudit/sequence_value_8')).toBe(true)
    expect(isKnownSequencerTemplateSlug('legacy/camaudit/not-a-template')).toBe(false)
    expect(isKnownSequencerTemplateSlug('nurture/grantpipe-value-1')).toBe(false)
  })
})

describe('CAMAudit shared nurture spine (value_8..value_14)', () => {
  const slugs = [
    'sequence_value_8',
    'sequence_value_9',
    'sequence_value_10',
    'sequence_value_11',
    'sequence_value_12',
    'sequence_value_13',
    'sequence_value_14',
  ] as const

  it.each(slugs)('renders %s with content, CTA, unsubscribe, and no em-dash', async (slug) => {
    const { renderCamauditLegacyEmail, hasCamauditLegacyTemplate } = await import(
      '../templates/camaudit/legacy'
    )
    expect(hasCamauditLegacyTemplate(slug)).toBe(true)
    const { html, text } = await renderCamauditLegacyEmail({
      templateSlug: slug,
      unsubscribeUrl: BASE_PROPS.unsubscribeUrl,
    })
    expect(html).toContain('CAMAudit')
    expect(html).toContain('href="https://camaudit.io/scan"')
    expect(html).toContain(BASE_PROPS.unsubscribeUrl)
    expect(text.length).toBeGreaterThan(80)
    expect(html).not.toContain('—')
    expect(text).not.toContain('—')
  })
})
