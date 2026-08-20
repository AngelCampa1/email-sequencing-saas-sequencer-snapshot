import { buildProductOptions } from '../../lib/product-options'
import type { ProductRow } from '../../lib/types'
import { Select, SelectItem } from './select'

/** Sentinel value meaning "no product filter applied" (show all). */
export const ALL_PRODUCTS = '__all__'

interface ProductFilterProps {
  /** Currently selected product slug, or ALL_PRODUCTS ('') for no filter. */
  value: string
  /** Called with the new slug (or ALL_PRODUCTS) when the selection changes. */
  onChange: (slug: string) => void
  /** Known products to populate the dropdown. */
  products: Pick<ProductRow, 'id' | 'slug' | 'name'>[]
  /** Orphaned slugs from data rows not in the products list. */
  extraSlugs?: string[]
  /** Label for the "show all" option. Defaults to "All products". */
  allLabel?: string
  /** Additional className forwarded to the Select trigger. */
  className?: string
  'aria-label'?: string
}

/**
 * Reusable product filter dropdown.
 *
 * Renders a Select with an "All products" sentinel item followed by one item per
 * product (sorted by name). Orphaned slugs referenced by data rows but absent from
 * the products list are appended via extraSlugs.
 *
 * Value semantics: empty string (ALL_PRODUCTS) = no filter; otherwise a product slug.
 */
export function ProductFilter({
  value,
  onChange,
  products,
  extraSlugs,
  allLabel = 'All products',
  className,
  'aria-label': ariaLabel,
}: ProductFilterProps) {
  const options = buildProductOptions(products, { extraSlugs })

  // Pass undefined to Select when the sentinel is active so that Radix renders
  // the placeholder text ("All products") in the trigger. When a real product
  // slug is selected, pass it through so Radix shows the product name.
  const selectValue = value === ALL_PRODUCTS ? undefined : value

  return (
    <Select
      value={selectValue}
      onValueChange={onChange}
      placeholder={allLabel}
      aria-label={ariaLabel}
      className={className}
    >
      <SelectItem value={ALL_PRODUCTS}>{allLabel}</SelectItem>
      {options.map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          {opt.label}
        </SelectItem>
      ))}
    </Select>
  )
}
