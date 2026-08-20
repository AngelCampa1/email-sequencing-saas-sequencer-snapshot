import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ALL_PRODUCTS, ProductFilter } from './product-filter'

const sampleProducts = [
  { id: 'id-1', slug: 'camaudit', name: 'CAMAudit' },
  { id: 'id-2', slug: 'floriva-web', name: 'Floriva' },
]

describe('ALL_PRODUCTS sentinel', () => {
  it('is a non-empty string constant', () => {
    expect(typeof ALL_PRODUCTS).toBe('string')
    expect(ALL_PRODUCTS.length).toBeGreaterThan(0)
  })
})

describe('ProductFilter (static markup)', () => {
  // Radix Select renders a Portal for SelectItem content; in renderToStaticMarkup
  // (SSR) the Portal is suppressed. The trigger renders the placeholder text when
  // the selected value cannot be resolved to an item label in SSR context.
  // We verify structural and attribute rendering through the trigger markup.

  it('renders the trigger element', () => {
    const html = renderToStaticMarkup(
      <ProductFilter value={ALL_PRODUCTS} onChange={() => {}} products={sampleProducts} />,
    )
    expect(html).toContain('inline-flex')
  })

  it('renders placeholder text as the allLabel in the trigger (SSR fallback)', () => {
    // In SSR, Radix Value falls back to placeholder when item text is not available.
    const html = renderToStaticMarkup(
      <ProductFilter value={ALL_PRODUCTS} onChange={() => {}} products={sampleProducts} />,
    )
    // placeholder is set to allLabel ("All products") — visible in SSR trigger
    expect(html).toContain('All products')
  })

  it('renders custom allLabel as placeholder in SSR', () => {
    const html = renderToStaticMarkup(
      <ProductFilter
        value={ALL_PRODUCTS}
        onChange={() => {}}
        products={sampleProducts}
        allLabel="Every product"
      />,
    )
    expect(html).toContain('Every product')
  })

  it('renders trigger without throwing for a product value', () => {
    const html = renderToStaticMarkup(
      <ProductFilter value="camaudit" onChange={() => {}} products={sampleProducts} />,
    )
    expect(html).toContain('inline-flex')
  })

  it('renders with empty products list without throwing', () => {
    const html = renderToStaticMarkup(
      <ProductFilter value={ALL_PRODUCTS} onChange={() => {}} products={[]} />,
    )
    expect(html).toContain('inline-flex')
    expect(html).toContain('All products')
  })

  it('renders with extraSlugs prop without throwing', () => {
    const html = renderToStaticMarkup(
      <ProductFilter
        value={ALL_PRODUCTS}
        onChange={() => {}}
        products={sampleProducts}
        extraSlugs={['orphan-slug']}
      />,
    )
    expect(html).toContain('inline-flex')
  })

  it('renders aria-label on the trigger', () => {
    const html = renderToStaticMarkup(
      <ProductFilter
        value={ALL_PRODUCTS}
        onChange={() => {}}
        products={sampleProducts}
        aria-label="Filter by product"
      />,
    )
    expect(html).toContain('aria-label="Filter by product"')
  })

  it('applies className to the trigger', () => {
    const html = renderToStaticMarkup(
      <ProductFilter
        value={ALL_PRODUCTS}
        onChange={() => {}}
        products={sampleProducts}
        className="w-44"
      />,
    )
    expect(html).toContain('w-44')
  })
})
