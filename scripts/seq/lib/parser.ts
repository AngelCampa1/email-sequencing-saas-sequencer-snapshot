import { isKnownSequencerTemplateSlug } from '@sequencer/emails'
import type { SequenceDefinition } from '@sequencer/shared'
import { SequenceDefinitionSchema } from '@sequencer/shared'
import { readFileSync } from 'fs'
import yaml from 'js-yaml'

export interface ParseResult {
  ok: true
  definition: SequenceDefinition
  filePath: string
}

export interface ParseError {
  ok: false
  filePath: string
  errors: string[]
}

export function parseSequenceFile(filePath: string): ParseResult | ParseError {
  try {
    const raw = yaml.load(readFileSync(filePath, 'utf8'))
    const result = SequenceDefinitionSchema.safeParse(raw)

    if (!result.success) {
      return {
        ok: false,
        filePath,
        errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      }
    }

    const def = result.data
    const extraErrors = validateSequenceDefinition(def)

    if (extraErrors.length > 0) {
      return { ok: false, filePath, errors: extraErrors }
    }

    return { ok: true, definition: def, filePath }
  } catch (e) {
    return { ok: false, filePath, errors: [(e as Error).message] }
  }
}

export function readSequenceSlugFromText(raw: string): string | null {
  const match = raw.match(/^slug:\s*['"]?([^'"\s#]+)['"]?/m)
  return match?.[1] ?? null
}

export function validateSequenceDefinition(def: SequenceDefinition): string[] {
  const errors: string[] = []

  if (def.variants && def.variants.length > 0) {
    const total = def.variants.reduce((s, v) => s + v.weight, 0)
    if (total !== 100) {
      errors.push(`Variant weights sum to ${total}, must be 100`)
    }

    const variantIds = def.variants.map((v) => v.id)
    const variantIdSet = new Set(variantIds)
    for (const step of def.steps) {
      if (typeof step.subject === 'string') continue

      const subjectKeys = Object.keys(step.subject)
      const subjectKeySet = new Set(subjectKeys)
      const missing = variantIds.filter((id) => !subjectKeySet.has(id))
      const unexpected = subjectKeys.filter((key) => !variantIdSet.has(key))
      if (missing.length > 0 || unexpected.length > 0) {
        const details = [
          missing.length > 0 ? `missing ${missing.join(', ')}` : '',
          unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; ')
        errors.push(`Step ${step.id} subject keys must match variant ids (${details})`)
      }
    }
  }

  const stepIds = def.steps.map((s) => s.id)
  const dupes = stepIds.filter((id, i) => stepIds.indexOf(id) !== i)
  if (dupes.length > 0) {
    errors.push(`Duplicate step IDs: ${dupes.join(', ')}`)
  }

  for (const step of def.steps) {
    if (!isKnownSequencerTemplateSlug(step.template)) {
      errors.push(`Unknown template slug: ${step.template} (step ${step.id})`)
    }
  }

  return errors
}

export function parseDelay(delay: string): number {
  // Returns milliseconds
  const match = delay.match(/^(\d+)(m|h|d)$/)
  if (!match) throw new Error(`Invalid delay: ${delay}`)
  const n = parseInt(match[1], 10)
  switch (match[2]) {
    case 'm':
      return n * 60_000
    case 'h':
      return n * 3_600_000
    case 'd':
      return n * 86_400_000
    default:
      throw new Error(`Invalid delay unit: ${match[2]}`)
  }
}

export function assignVariant(
  variants: Array<{ id: string; weight: number }>,
  deterministicSeed: string,
): string {
  // Deterministic variant assignment based on contact email hash
  // Simple: sum char codes mod 100 and find bucket
  const hash = deterministicSeed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 100
  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (hash < cumulative) return variant.id
  }
  return variants[variants.length - 1].id
}
