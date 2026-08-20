export const DEFAULT_SEND_TIME_ZONE = 'America/Chicago'
const SEND_START_HOUR = 8
const SEND_END_HOUR = 17
const TIME_ZONE_PROPERTY_KEYS = ['timezone', 'time_zone', 'tz']

type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function resolveSendTimeZone(
  contactProperties?: Record<string, unknown> | null,
  productContactProperties?: Record<string, unknown> | null,
): string {
  return (
    findValidTimeZone(productContactProperties) ??
    findValidTimeZone(contactProperties) ??
    DEFAULT_SEND_TIME_ZONE
  )
}

export function nextAllowedSendTime(epochMs: number, timeZone: string): number {
  const safeTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_SEND_TIME_ZONE
  const local = getLocalParts(epochMs, safeTimeZone)

  if (local.hour >= SEND_START_HOUR && local.hour < SEND_END_HOUR) {
    return epochMs
  }

  const targetDay = local.hour < SEND_START_HOUR ? local.day : local.day + 1
  return localDateTimeToUtcMs(
    {
      year: local.year,
      month: local.month,
      day: targetDay,
      hour: SEND_START_HOUR,
      minute: 0,
      second: 0,
    },
    safeTimeZone,
  )
}

function findValidTimeZone(properties?: Record<string, unknown> | null): string | null {
  if (!properties) return null
  for (const key of TIME_ZONE_PROPERTY_KEYS) {
    const value = properties[key]
    if (typeof value === 'string' && isValidTimeZone(value)) return value
  }
  return null
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

function getLocalParts(epochMs: number, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

function localDateTimeToUtcMs(local: LocalParts, timeZone: string): number {
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  )
  let utc = localAsUtc - getOffsetMs(localAsUtc, timeZone)

  for (let i = 0; i < 3; i++) {
    utc = localAsUtc - getOffsetMs(utc, timeZone)
  }

  return utc
}

function getOffsetMs(epochMs: number, timeZone: string): number {
  const local = getLocalParts(epochMs, timeZone)
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  )
  return localAsUtc - epochMs
}
