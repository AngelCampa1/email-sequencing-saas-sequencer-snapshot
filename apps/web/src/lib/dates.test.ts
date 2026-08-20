import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from './dates'

const ISO = '2026-05-20T10:00:00.000Z'

describe('formatDate', () => {
  it('formats an ISO string with a spelled-out month and no time', () => {
    const out = formatDate(ISO)
    expect(out).toContain('May')
    expect(out).toContain('2026')
    // no time component
    expect(out).not.toMatch(/AM|PM/)
  })

  it('accepts a Date instance', () => {
    expect(formatDate(new Date(ISO))).toContain('2026')
  })

  it('treats a date-only string as a local calendar date, with no timezone shift', () => {
    // 'YYYY-MM-DD' parsed via new Date() is UTC midnight, which can render as
    // the previous day in negative-offset zones. formatDate must keep the date.
    expect(formatDate('2026-05-20')).toBe('May 20, 2026')
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('renders an em dash for empty, null, or invalid input', () => {
    expect(formatDate('')).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('formats an ISO string with a month, year, and a time without seconds', () => {
    const out = formatDateTime(ISO)
    expect(out).toContain('May')
    expect(out).toContain('2026')
    expect(out).toMatch(/AM|PM/)
    // minutes shown, seconds not (no second ":ss" segment after the minutes)
    expect(out).not.toMatch(/:\d{2}:\d{2}/)
  })

  it('renders an em dash for empty, null, or invalid input', () => {
    expect(formatDateTime('')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('nope')).toBe('—')
  })
})
