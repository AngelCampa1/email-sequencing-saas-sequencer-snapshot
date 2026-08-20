import { describe, expect, it } from 'vitest'
import { formatQueryError } from './query-error'

describe('formatQueryError', () => {
  it('returns an Error message', () => {
    expect(formatQueryError(new Error('Request failed'))).toBe('Request failed')
  })

  it('falls back when the error is not an Error', () => {
    expect(formatQueryError({ message: 'not trusted' })).toBe('Unknown error')
  })

  it('falls back for empty Error messages', () => {
    expect(formatQueryError(new Error(''))).toBe('Unknown error')
  })
})
