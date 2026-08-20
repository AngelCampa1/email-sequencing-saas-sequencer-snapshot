import { describe, expect, it } from 'vitest'
import { humanizeGoal } from './SequencesPage'

describe('humanizeGoal', () => {
  it('converts snake_case to a capitalized phrase', () => {
    expect(humanizeGoal('drive_engagement')).toBe('Drive engagement')
  })

  it('converts hyphenated tokens too', () => {
    expect(humanizeGoal('win-back')).toBe('Win back')
  })

  it('capitalizes a single word', () => {
    expect(humanizeGoal('onboarding')).toBe('Onboarding')
  })

  it('collapses repeated separators', () => {
    expect(humanizeGoal('re__activate')).toBe('Re activate')
  })
})
