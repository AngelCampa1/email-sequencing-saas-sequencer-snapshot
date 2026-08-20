import { describe, expect, it } from 'vitest'
import { formatDelay, formatSkipIf, formatSubject } from './sequence-step-format'

describe('sequence step subject display', () => {
  it('shows a plain string subject as-is', () => {
    expect(formatSubject('Welcome to GrantPipe')).toBe('Welcome to GrantPipe')
  })

  it('shows the distinct subjects when a step has per-variant subjects', () => {
    expect(formatSubject({ a: 'Your checklist', b: 'Get your checklist' })).toBe(
      'Your checklist · Get your checklist',
    )
  })

  it('collapses identical variant subjects to one line', () => {
    expect(formatSubject({ a: 'Same subject', b: 'Same subject' })).toBe('Same subject')
  })

  it('uses a dash when no subject is set', () => {
    expect(formatSubject(undefined)).toBe('—')
    expect(formatSubject('   ')).toBe('—')
    expect(formatSubject({})).toBe('—')
  })
})

describe('sequence step delay display', () => {
  it('says Right away when there is no wait', () => {
    expect(formatDelay('0m')).toBe('Right away')
    expect(formatDelay('0d')).toBe('Right away')
  })

  it('uses the singular unit for a delay of one', () => {
    expect(formatDelay('1d')).toBe('1 day')
    expect(formatDelay('1h')).toBe('1 hour')
  })

  it('pluralizes the unit for delays over one', () => {
    expect(formatDelay('2d')).toBe('2 days')
    expect(formatDelay('7d')).toBe('7 days')
    expect(formatDelay('30m')).toBe('30 minutes')
    expect(formatDelay('1w')).toBe('1 week')
  })

  it('falls back to a dash or the raw token when the format is unknown', () => {
    expect(formatDelay(undefined)).toBe('—')
    expect(formatDelay('')).toBe('—')
    expect(formatDelay('soon')).toBe('soon')
  })
})

describe('sequence step skip_if display', () => {
  it('shows true skip_if event gates as a readable, humanized list', () => {
    expect(
      formatSkipIf({
        reply_received: true,
        booked_demo: true,
      }),
    ).toBe('Reply received, Booked demo')
  })

  it('marks unsupported skip_if values as ignored', () => {
    expect(
      formatSkipIf({
        score: 80,
        segment: 'enterprise',
        metadata: { source: 'lead-magnet' },
      }),
    ).toBe('Score (ignored), Segment (ignored), Metadata (ignored)')
  })

  it('uses a dash when no skip_if rules are present', () => {
    expect(formatSkipIf(undefined)).toBe('—')
    expect(formatSkipIf({})).toBe('—')
  })
})
