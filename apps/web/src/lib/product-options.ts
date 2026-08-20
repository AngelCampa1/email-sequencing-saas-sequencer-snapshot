import type { ProductRow } from './types'

export interface ProductOption {
  value: string
  label: string
}

/**
 * Builds a sorted list of ProductOption entries for use in product filter dropdowns.
 *
 * Each known product maps to { value: slug, label: name }. Any extra slug or id
 * references that do not match a known product (orphaned references from sequence rows,
 * etc.) are appended as options with value=the slug/id and label=the slug/id itself.
 * Results are de-duplicated by value and sorted by label ascending.
 *
 * Value semantics: slug — consistent with how SequencesPage derives product slugs
 * from product rows (p.slug) when labelling sequences.
 */
export function buildProductOptions(
  products: Pick<ProductRow, 'id' | 'slug' | 'name'>[],
  opts?: { extraIds?: string[]; extraSlugs?: string[] },
): ProductOption[] {
  // Build a map from id → slug and a set of known slugs for fast lookup
  const idToSlug = new Map<string, string>()
  const knownSlugs = new Set<string>()
  for (const p of products) {
    idToSlug.set(p.id, p.slug)
    knownSlugs.add(p.slug)
  }

  // Start with known product options
  const byValue = new Map<string, ProductOption>()
  for (const p of products) {
    byValue.set(p.slug, { value: p.slug, label: p.name })
  }

  // Append orphaned extraSlugs (not already a known product slug)
  for (const slug of opts?.extraSlugs ?? []) {
    if (!knownSlugs.has(slug) && !byValue.has(slug)) {
      byValue.set(slug, { value: slug, label: slug })
    }
  }

  // Append orphaned extraIds — if the id maps to a known product slug, skip it;
  // otherwise treat the id itself as the value/label
  for (const id of opts?.extraIds ?? []) {
    const resolvedSlug = idToSlug.get(id)
    if (resolvedSlug !== undefined) {
      // This id belongs to a known product — already present, skip
      continue
    }
    if (!byValue.has(id)) {
      byValue.set(id, { value: id, label: id })
    }
  }

  // Sort by label ascending
  return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label))
}
