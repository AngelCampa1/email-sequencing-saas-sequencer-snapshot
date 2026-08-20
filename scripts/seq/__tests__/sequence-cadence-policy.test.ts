import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { SequenceDefinition } from '@sequencer/shared'
import { globSync } from 'glob'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { parseDelay } from '../lib/parser.js'
import { validateSequencePolicy } from '../lib/sequence-policy.js'

const DAY_MS = 86_400_000

// A "nurture-first" sequence opens with educational/value content, not a
// transactional welcome or asset-delivery email. Those must not fire at
// enrollment time — the immediate email is sent elsewhere — so the first
// touch has to wait at least a day. Welcome/onboarding-first sequences are
// intentionally immediate and excluded here.
function isNurtureFirst(definition: SequenceDefinition): boolean {
  const firstTemplate = definition.steps[0]?.template ?? ''
  return /^nurture\//.test(firstTemplate) || /^legacy\/camaudit\/.*_step_1$/.test(firstTemplate)
}

describe('sequence cadence and value policy', () => {
  const root = resolve(__dirname, '../../..')
  const sequenceFiles = globSync(resolve(root, 'sequences/**/*.yaml').replace(/\\/g, '/'))

  it('keeps every sequence to 14 daily touches across 14 days', () => {
    expect(sequenceFiles.length).toBeGreaterThan(0)
    const violations: string[] = []

    for (const file of sequenceFiles) {
      const definition = yaml.load(readFileSync(file, 'utf8')) as SequenceDefinition
      violations.push(
        ...validateSequencePolicy(definition).map((e) => `${relative(root, file)} ${e}`),
      )
    }

    expect(violations).toEqual([])
  })

  it('starts nurture-first sequences at least one day after enrollment', () => {
    expect(sequenceFiles.length).toBeGreaterThan(0)
    const violations: string[] = []

    for (const file of sequenceFiles) {
      const definition = yaml.load(readFileSync(file, 'utf8')) as SequenceDefinition
      if (!isNurtureFirst(definition)) continue
      const firstDelayMs = parseDelay(definition.steps[0].delay)
      if (firstDelayMs < DAY_MS) {
        violations.push(
          `${relative(root, file)} first nurture touch fires at ${definition.steps[0].delay}; must be >= 1d`,
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('does not use selfish reminder subjects for touches', () => {
    expect(sequenceFiles.length).toBeGreaterThan(0)
    const selfishSubjectPattern =
      /\b(did you|get a chance|checking in|check-in|quick check|quick .*setup pass|last call|ready to|just following|follow up|following up|bumping)\b/i
    const violations: string[] = []

    for (const file of sequenceFiles) {
      const definition = yaml.load(readFileSync(file, 'utf8')) as SequenceDefinition
      violations.push(
        ...validateSequencePolicy(definition).filter((e) => selfishSubjectPattern.test(e)),
      )
    }

    expect(violations).toEqual([])
  })
})

describe('validateSequencePolicy 14-daily cadence', () => {
  type Step = SequenceDefinition['steps'][number]
  const step = (id: string, delay: string): Step =>
    ({ id, delay, template: `nurture/x-${id}`, subject: `Subject for ${id}` }) as Step
  const seq = (steps: Step[]): SequenceDefinition =>
    ({ slug: 'x', product: 'camaudit', version: 1, steps }) as SequenceDefinition

  // 14 daily touches. First touch is immediate (0m, e.g. welcome / magnet
  // delivery), the remaining 13 each fire one day after the previous.
  const dailyCadence = (firstDelay = '0m', count = 14): SequenceDefinition =>
    seq(
      Array.from({ length: count }, (_, i) => step(`value-${i + 1}`, i === 0 ? firstDelay : '1d')),
    )
  it('accepts 14 daily touches starting immediately', () => {
    expect(validateSequencePolicy(dailyCadence('0m'))).toEqual([])
  })

  it('accepts 14 daily touches starting one day after enrollment', () => {
    expect(validateSequencePolicy(dailyCadence('1d'))).toEqual([])
  })

  it('rejects fewer than 14 touches', () => {
    const errors = validateSequencePolicy(dailyCadence('0m', 7))
    expect(errors.some((e) => /Expected 14 touches, found 7/.test(e))).toBe(true)
  })

  it('rejects more than 14 touches', () => {
    const errors = validateSequencePolicy(dailyCadence('0m', 15))
    expect(errors.some((e) => /Expected 14 touches, found 15/.test(e))).toBe(true)
  })

  it('rejects a multi-day gap between touches (not daily)', () => {
    const steps = Array.from({ length: 14 }, (_, i) =>
      step(`value-${i + 1}`, i === 0 ? '0m' : '1d'),
    )
    steps[7] = step('value-8', '4d') // a 4-day gap breaks the daily cadence
    const errors = validateSequencePolicy(seq(steps))
    expect(errors.some((e) => /daily/i.test(e))).toBe(true)
  })

  it('rejects a first touch later than day 1', () => {
    const errors = validateSequencePolicy(dailyCadence('3d'))
    expect(errors.some((e) => /first touch/i.test(e))).toBe(true)
  })

  it('exempts the resource delivery step from the 14-touch count', () => {
    // A resource step delivers the magnet at enrollment (0m) and must not count
    // toward the 14 cadence touches nor shift the daily schedule.
    const steps: Step[] = [
      step('resource', '0m'),
      ...Array.from({ length: 14 }, (_, i) => step(`value-${i + 1}`, i === 0 ? '0m' : '1d')),
    ]
    expect(validateSequencePolicy(seq(steps))).toEqual([])
  })

  it('still scans every step subject for selfish reminder language', () => {
    const steps = Array.from({ length: 14 }, (_, i) =>
      step(`value-${i + 1}`, i === 0 ? '0m' : '1d'),
    )
    steps[5] = { ...step('value-6', '1d'), subject: 'Did you get a chance to set up?' } as Step
    const errors = validateSequencePolicy(seq(steps))
    expect(errors.some((e) => /selfish reminder subject/.test(e))).toBe(true)
  })
})
