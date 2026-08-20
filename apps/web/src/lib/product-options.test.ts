import { describe, expect, it } from 'vitest'
import type { ProductOption } from './product-options'
import { buildProductOptions } from './product-options'

const makeProduct = (id: string, slug: string, name: string) => ({ id, slug, name })

describe('buildProductOptions', () => {
  it('maps products to options with value=slug and label=name', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    const opts = buildProductOptions(products)
    expect(opts).toEqual<ProductOption[]>([{ value: 'camaudit', label: 'CAMAudit' }])
  })

  it('returns empty array for no products and no extras', () => {
    expect(buildProductOptions([])).toEqual([])
  })

  it('sorts options by label ascending', () => {
    const products = [
      makeProduct('id-1', 'zebra', 'Zebra'),
      makeProduct('id-2', 'alpha', 'Alpha'),
      makeProduct('id-3', 'middle', 'Middle'),
    ]
    const opts = buildProductOptions(products)
    expect(opts.map((o) => o.label)).toEqual(['Alpha', 'Middle', 'Zebra'])
  })

  it('appends orphaned extraSlugs not present in products', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    const opts = buildProductOptions(products, { extraSlugs: ['orphan-slug'] })
    expect(opts).toContainEqual({ value: 'orphan-slug', label: 'orphan-slug' })
    expect(opts).toHaveLength(2)
  })

  it('appends orphaned extraIds not present in products', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    const opts = buildProductOptions(products, { extraIds: ['unknown-id-999'] })
    expect(opts).toContainEqual({ value: 'unknown-id-999', label: 'unknown-id-999' })
    expect(opts).toHaveLength(2)
  })

  it('does not add extraSlugs that match an existing product slug', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    const opts = buildProductOptions(products, { extraSlugs: ['camaudit'] })
    expect(opts).toHaveLength(1)
    expect(opts[0].value).toBe('camaudit')
  })

  it('does not add extraIds that resolve to an existing product id', () => {
    const products = [makeProduct('id-1', 'floriva-web', 'Floriva')]
    const opts = buildProductOptions(products, { extraIds: ['id-1'] })
    // id-1 maps to slug 'floriva-web', so no duplicate should appear
    expect(opts).toHaveLength(1)
    expect(opts[0].value).toBe('floriva-web')
  })

  it('de-duplicates by value when extra slug matches via different paths', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    // Both extraSlugs and extraIds refer to same known product — no duplicate
    const opts = buildProductOptions(products, {
      extraSlugs: ['camaudit'],
      extraIds: ['id-1'],
    })
    expect(opts).toHaveLength(1)
  })

  it('de-duplicates extra slugs listed multiple times', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    const opts = buildProductOptions(products, {
      extraSlugs: ['orphan', 'orphan'],
    })
    const orphanCount = opts.filter((o) => o.value === 'orphan').length
    expect(orphanCount).toBe(1)
  })

  it('handles both extraSlugs and extraIds simultaneously', () => {
    const products = [makeProduct('id-1', 'camaudit', 'CAMAudit')]
    const opts = buildProductOptions(products, {
      extraSlugs: ['new-slug'],
      extraIds: ['new-id'],
    })
    expect(opts).toHaveLength(3)
    expect(opts.map((o) => o.value)).toContain('new-slug')
    expect(opts.map((o) => o.value)).toContain('new-id')
  })

  it('sorts orphaned extras mixed with known products by label', () => {
    const products = [
      makeProduct('id-1', 'zzz-product', 'ZZZ Product'),
      makeProduct('id-2', 'aaa-product', 'AAA Product'),
    ]
    const opts = buildProductOptions(products, { extraSlugs: ['mmm-orphan'] })
    expect(opts[0].label).toBe('AAA Product')
    expect(opts[1].label).toBe('mmm-orphan')
    expect(opts[2].label).toBe('ZZZ Product')
  })

  it('returns correct ProductOption shape', () => {
    const products = [makeProduct('id-1', 'grantpipe', 'GrantPipe')]
    const [opt] = buildProductOptions(products)
    expect(opt).toHaveProperty('value')
    expect(opt).toHaveProperty('label')
    expect(typeof opt.value).toBe('string')
    expect(typeof opt.label).toBe('string')
  })
})
