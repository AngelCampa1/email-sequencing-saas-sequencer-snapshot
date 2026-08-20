import { describe, expect, it } from 'vitest'
import { parseDelay } from '../lib/parse-delay'
import { assignVariant } from '../lib/variant'

describe('parseDelay', () => {
  it('0m -> 0ms', () => expect(parseDelay('0m')).toBe(0))
  it('2d -> 172800000ms', () => expect(parseDelay('2d')).toBe(172_800_000))
  it('5d -> 432000000ms', () => expect(parseDelay('5d')).toBe(432_000_000))
  it('1h -> 3600000ms', () => expect(parseDelay('1h')).toBe(3_600_000))
  it('throws on bad format', () => expect(() => parseDelay('bad')).toThrow())
  it('throws on missing unit', () => expect(() => parseDelay('5')).toThrow())
})

describe('assignVariant', () => {
  const variants = [
    { id: 'control', weight: 50 },
    { id: 'treatment', weight: 50 },
  ]

  it('returns a valid variant', () => {
    const result = assignVariant(variants, 'user@example.com')
    expect(['control', 'treatment']).toContain(result)
  })

  it('is deterministic', () => {
    const a = assignVariant(variants, 'alice@example.com')
    const b = assignVariant(variants, 'alice@example.com')
    expect(a).toBe(b)
  })

  it('can produce both variants', () => {
    const emails = [
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
      'e@x.com',
      'f@x.com',
      'g@x.com',
      'h@x.com',
    ]
    const results = new Set(emails.map((e) => assignVariant(variants, e)))
    expect(results.size).toBeGreaterThan(1)
  })

  it('respects unequal weights (90/10 skews heavily)', () => {
    const skewed = [
      { id: 'a', weight: 90 },
      { id: 'b', weight: 10 },
    ]
    const emails = Array.from({ length: 100 }, (_, i) => `user${i}@x.com`)
    const results = emails.map((e) => assignVariant(skewed, e))
    const aCount = results.filter((r) => r === 'a').length
    // With 100 emails and 90% weight for 'a', expect at least 70
    expect(aCount).toBeGreaterThan(70)
  })
})

describe('SequenceRunDO exports', () => {
  it('class is exported from durable-objects/sequence-run', async () => {
    const mod = await import('../durable-objects/sequence-run')
    expect(typeof mod.SequenceRunDO).toBe('function')
  })
})
