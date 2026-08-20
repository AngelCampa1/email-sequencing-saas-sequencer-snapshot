// @vitest-environment jsdom
import '../../test/interaction-setup'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ALL_PRODUCTS, ProductFilter } from './product-filter'

const sampleProducts = [
  { id: 'id-1', slug: 'camaudit', name: 'CAMAudit' },
  { id: 'id-2', slug: 'floriva-web', name: 'Floriva' },
]

describe('ProductFilter interaction (jsdom)', () => {
  it('renders a trigger button in the DOM', () => {
    render(<ProductFilter value={ALL_PRODUCTS} onChange={() => {}} products={sampleProducts} />)
    // Radix Select renders a button role for the trigger
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDefined()
  })

  it('shows "All products" as the placeholder text in the trigger', () => {
    render(<ProductFilter value={ALL_PRODUCTS} onChange={() => {}} products={sampleProducts} />)
    expect(screen.getByText('All products')).toBeDefined()
  })

  it('shows custom allLabel as placeholder text', () => {
    render(
      <ProductFilter
        value={ALL_PRODUCTS}
        onChange={() => {}}
        products={sampleProducts}
        allLabel="Pick a product"
      />,
    )
    expect(screen.getByText('Pick a product')).toBeDefined()
  })

  it('does not call onChange before any user interaction', () => {
    const onChange = vi.fn()
    render(<ProductFilter value={ALL_PRODUCTS} onChange={onChange} products={sampleProducts} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDefined()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the selected product name when a slug value is set', () => {
    render(<ProductFilter value="camaudit" onChange={() => {}} products={sampleProducts} />)
    // Radix renders the selected item text in the trigger
    expect(screen.getByText('CAMAudit')).toBeDefined()
  })

  it('renders with aria-label accessible on the trigger', () => {
    render(
      <ProductFilter
        value={ALL_PRODUCTS}
        onChange={() => {}}
        products={sampleProducts}
        aria-label="Product selector"
      />,
    )
    const trigger = screen.getByLabelText('Product selector')
    expect(trigger).toBeDefined()
  })
})
