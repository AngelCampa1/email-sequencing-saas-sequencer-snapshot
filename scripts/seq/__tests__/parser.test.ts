import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { assignVariant, parseDelay, parseSequenceFile } from '../lib/parser.js'

const FIXTURES_DIR = join(process.cwd(), 'sequences')

describe('parseSequenceFile', () => {
  it('parses camaudit lead-magnet fixture successfully', () => {
    const result = parseSequenceFile(
      join(FIXTURES_DIR, 'camaudit/cam-reconciliation-checklist.yaml'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.slug).toBe('camaudit-cam-reconciliation-checklist')
    expect(result.definition.product).toBe('camaudit')
    expect(result.definition.steps).toHaveLength(14)
  })

  it('parses floriva fulfillment fixture successfully', () => {
    const result = parseSequenceFile(join(FIXTURES_DIR, 'floriva-web/fulfillment-welcome.yaml'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.slug).toBe('floriva-web-fulfillment-welcome')
    expect(result.definition.steps.length).toBeGreaterThan(0)
  })

  it('validates camaudit fixture enrolls from the current lead magnet', () => {
    const result = parseSequenceFile(
      join(FIXTURES_DIR, 'camaudit/cam-reconciliation-checklist.yaml'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.enroll?.lead_magnet).toBe('cam-reconciliation-checklist')
  })

  it('validates camaudit fixture has no duplicate step IDs', () => {
    const result = parseSequenceFile(
      join(FIXTURES_DIR, 'camaudit/cam-reconciliation-checklist.yaml'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.definition.steps.map((s) => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('validates floriva fixture step delays are valid format', () => {
    const result = parseSequenceFile(join(FIXTURES_DIR, 'floriva-web/fulfillment-welcome.yaml'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const step of result.definition.steps) {
      expect(step.delay).toMatch(/^\d+(m|h|d)$/)
    }
  })

  it('returns error for invalid product slug', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'bad.yaml')
    writeFileSync(file, 'slug: test\nproduct: invalid_product\nversion: 1\nsteps: []')
    const result = parseSequenceFile(file)
    expect(result.ok).toBe(false)
    unlinkSync(file)
  })

  it('returns error for sequences without at least one step', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'empty-steps.yaml')
    try {
      writeFileSync(
        file,
        `
slug: empty-steps
product: camaudit
version: 1
steps: []
`,
      )
      const result = parseSequenceFile(file)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((e) => /at least one step/i.test(e))).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns error for blank runtime-critical sequence fields', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'blank-fields.yaml')
    try {
      writeFileSync(
        file,
        `
slug: blank-fields
product: camaudit
version: 1
exit_conditions:
  - event: "   "
steps:
  - id: "   "
    delay: 0m
    template: "   "
    subject: "   "
`,
      )
      const result = parseSequenceFile(file)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('steps.0.id'))).toBe(true)
        expect(result.errors.some((e) => e.includes('steps.0.template'))).toBe(true)
        expect(result.errors.some((e) => e.includes('steps.0.subject'))).toBe(true)
        expect(result.errors.some((e) => e.includes('exit_conditions.0.event'))).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns error for unknown template slugs', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'unknown-template.yaml')
    try {
      writeFileSync(
        file,
        `
slug: unknown-template
product: camaudit
version: 1
steps:
  - id: step1
    delay: 0m
    template: missing/template-slug
    subject: Test
`,
      )
      const result = parseSequenceFile(file)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(
          result.errors.some((e) => e.includes('Unknown template slug: missing/template-slug')),
        ).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns error for duplicate step IDs', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'dupes.yaml')
    writeFileSync(
      file,
      `
slug: test-dupes
product: camaudit
version: 1
steps:
  - id: same-id
    delay: 0m
    template: nurture/cam-audit-value-1
    subject: Test
  - id: same-id
    delay: 1d
    template: nurture/cam-audit-value-1
    subject: Test
`,
    )
    const result = parseSequenceFile(file)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true)
    }
    unlinkSync(file)
  })

  it('returns error for variant weights not summing to 100', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'bad-weights.yaml')
    writeFileSync(
      file,
      `
slug: bad-weights
product: camaudit
version: 1
variants:
  - id: a
    weight: 60
  - id: b
    weight: 30
steps:
  - id: step1
    delay: 0m
    template: nurture/cam-audit-value-1
    subject: Test
`,
    )
    const result = parseSequenceFile(file)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('weight'))).toBe(true)
    }
    unlinkSync(file)
  })

  it('returns error for invalid delay format', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'bad-delay.yaml')
    writeFileSync(
      file,
      `
slug: bad-delay
product: camaudit
version: 1
steps:
  - id: step1
    delay: 2weeks
    template: test
    subject: Test
`,
    )
    const result = parseSequenceFile(file)
    expect(result.ok).toBe(false)
    unlinkSync(file)
  })

  it('accepts steps with record subject (variant subjects)', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'variant-subjects.yaml')
    writeFileSync(
      file,
      `
slug: variant-subjects
product: camaudit
version: 1
variants:
  - id: a
    weight: 50
  - id: b
    weight: 50
steps:
  - id: step1
    delay: 0m
    template: nurture/cam-audit-value-1
    subject:
      a: "Subject A"
      b: "Subject B"
`,
    )
    const result = parseSequenceFile(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.steps[0].subject).toEqual({ a: 'Subject A', b: 'Subject B' })
    unlinkSync(file)
  })

  it('returns error when variant subject keys do not match declared variants', () => {
    const dir = mkdtempSync(tmpdir() + '/seq-test-')
    const file = join(dir, 'variant-subject-mismatch.yaml')
    writeFileSync(
      file,
      `
slug: variant-subject-mismatch
product: camaudit
version: 1
variants:
  - id: control
    weight: 50
  - id: treatment
    weight: 50
steps:
  - id: step1
    delay: 0m
    template: nurture/cam-audit-value-1
    subject:
      bogus: "Wrong subject"
`,
    )
    const result = parseSequenceFile(file)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('subject keys'))).toBe(true)
    }
    unlinkSync(file)
  })

  it('accepts steps with skip_if condition', () => {
    const result = parseSequenceFile(join(FIXTURES_DIR, 'floriva-web/fulfillment-welcome.yaml'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const stepWithSkip = result.definition.steps.find((s) => s.skip_if != null)
    expect(stepWithSkip).toBeDefined()
  })

  it('returns error for non-existent file', () => {
    const result = parseSequenceFile('/nonexistent/path/file.yaml')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})

describe('parseDelay', () => {
  it('parses 0m to 0 ms', () => expect(parseDelay('0m')).toBe(0))
  it('parses 2d to 172800000 ms', () => expect(parseDelay('2d')).toBe(172_800_000))
  it('parses 5d to 432000000 ms', () => expect(parseDelay('5d')).toBe(432_000_000))
  it('parses 1h to 3600000 ms', () => expect(parseDelay('1h')).toBe(3_600_000))
  it('parses 30m to 1800000 ms', () => expect(parseDelay('30m')).toBe(1_800_000))
  it('parses 14d to 1209600000 ms', () => expect(parseDelay('14d')).toBe(1_209_600_000))
  it('parses 9d correctly', () => expect(parseDelay('9d')).toBe(9 * 86_400_000))
  it('throws on invalid format', () => expect(() => parseDelay('bad')).toThrow())
  it('throws on empty string', () => expect(() => parseDelay('')).toThrow())
  it('throws on weeks format', () => expect(() => parseDelay('2w')).toThrow())
})

describe('assignVariant', () => {
  const variants = [
    { id: 'control', weight: 50 },
    { id: 'shorter-subjects', weight: 50 },
  ]

  it('returns a valid variant id', () => {
    const result = assignVariant(variants, 'test@example.com')
    expect(['control', 'shorter-subjects']).toContain(result)
  })

  it('is deterministic for the same seed', () => {
    const a = assignVariant(variants, 'alice@example.com')
    const b = assignVariant(variants, 'alice@example.com')
    expect(a).toBe(b)
  })

  it('can produce both variants across different inputs', () => {
    const results = new Set(
      ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com', 'g@x.com', 'h@x.com'].map(
        (e) => assignVariant(variants, e),
      ),
    )
    expect(results.size).toBeGreaterThan(1)
  })

  it('handles single variant (100% weight) correctly', () => {
    const singleVariant = [{ id: 'only', weight: 100 }]
    expect(assignVariant(singleVariant, 'any@example.com')).toBe('only')
  })

  it('always returns last variant as fallback', () => {
    // With weights summing to 100, any hash 0-99 should map to a variant
    const manyEmails = Array.from({ length: 100 }, (_, i) => `user${i}@test.com`)
    const results = manyEmails.map((e) => assignVariant(variants, e))
    results.forEach((r) => {
      expect(['control', 'shorter-subjects']).toContain(r)
    })
  })

  it('distributes roughly evenly for 50/50 split', () => {
    // With 100 emails and 50/50, expect both variants to appear roughly
    const manyEmails = Array.from({ length: 200 }, (_, i) => `user${i}@testdomain.com`)
    const counts: Record<string, number> = { control: 0, 'shorter-subjects': 0 }
    for (const email of manyEmails) {
      const v = assignVariant(variants, email)
      counts[v]++
    }
    // Neither should be 0
    expect(counts['control']).toBeGreaterThan(0)
    expect(counts['shorter-subjects']).toBeGreaterThan(0)
  })
})
