export function assignVariant(
  variants: Array<{ id: string; weight: number }>,
  seed: string,
): string {
  const hash = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 100
  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (hash < cumulative) return variant.id
  }
  return variants[variants.length - 1].id
}
