import { describe, expect, it } from 'vitest'
import { DEFAULT_SEND_TIME_ZONE, nextAllowedSendTime, resolveSendTimeZone } from './send-window'

describe('send window', () => {
  it('allows sends from 8:00 through 4:59 in the recipient timezone', () => {
    const now = Date.parse('2026-06-01T13:00:00.000Z') // 8:00 AM America/Chicago

    expect(nextAllowedSendTime(now, 'America/Chicago')).toBe(now)
  })

  it('defers midnight sends to 8:00 AM in the recipient timezone', () => {
    const next = nextAllowedSendTime(
      Date.parse('2026-06-01T05:00:00.000Z'), // 12:00 AM America/Chicago
      'America/Chicago',
    )

    expect(new Date(next).toISOString()).toBe('2026-06-01T13:00:00.000Z')
  })

  it('defers at 5:00 PM to 8:00 AM the next local day', () => {
    const next = nextAllowedSendTime(
      Date.parse('2026-06-01T22:00:00.000Z'), // 5:00 PM America/Chicago
      'America/Chicago',
    )

    expect(new Date(next).toISOString()).toBe('2026-06-02T13:00:00.000Z')
  })

  it('uses the recipient timezone when present', () => {
    const next = nextAllowedSendTime(
      Date.parse('2026-06-01T12:00:00.000Z'), // 5:00 AM America/Los_Angeles
      'America/Los_Angeles',
    )

    expect(new Date(next).toISOString()).toBe('2026-06-01T15:00:00.000Z')
  })

  it('falls back to Central time for missing or invalid timezones', () => {
    expect(resolveSendTimeZone(undefined, undefined)).toBe(DEFAULT_SEND_TIME_ZONE)
    expect(resolveSendTimeZone({ timezone: 'Not/A_Zone' }, undefined)).toBe(DEFAULT_SEND_TIME_ZONE)
  })

  it('prefers product-scoped timezone properties over global contact properties', () => {
    expect(
      resolveSendTimeZone({ timezone: 'America/New_York' }, { time_zone: 'America/Los_Angeles' }),
    ).toBe('America/Los_Angeles')
  })
})
