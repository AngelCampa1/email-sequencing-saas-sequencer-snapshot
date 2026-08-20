import { EM_DASH } from '../lib/dates'
import { humanizeToken } from '../lib/labels'

const DELAY_UNITS: Record<string, string> = {
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
}

/**
 * Turn a compiled delay token (e.g. "0m", "1d", "2d") into plain words an
 * operator can read at a glance ("Right away", "1 day", "2 days"). Falls back
 * to the raw token when the format is not recognized.
 */
export function formatDelay(delay: unknown): string {
  if (typeof delay !== 'string') return EM_DASH
  const trimmed = delay.trim()
  if (trimmed === '') return EM_DASH

  const match = /^(\d+)([mhdw])$/.exec(trimmed)
  if (!match) return trimmed

  const amount = Number(match[1])
  const unit = DELAY_UNITS[match[2]]
  if (amount === 0) return 'Right away'
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`
}

export function formatSkipIf(skipIf: unknown): string {
  if (!skipIf || typeof skipIf !== 'object' || Array.isArray(skipIf)) return EM_DASH

  const entries = Object.entries(skipIf as Record<string, unknown>)
  if (entries.length === 0) return EM_DASH

  return entries
    .map(([key, value]) =>
      value === true ? humanizeToken(key) : `${humanizeToken(key)} (ignored)`,
    )
    .join(', ')
}

/**
 * The subject line for a step. A subject can be a single string or a map of
 * variant id to subject (for A/B steps). Show the distinct subject lines so the
 * operator can read what each email says. Returns an em dash when none is set.
 */
export function formatSubject(subject: unknown): string {
  if (typeof subject === 'string') {
    const trimmed = subject.trim()
    return trimmed === '' ? EM_DASH : trimmed
  }
  if (subject && typeof subject === 'object' && !Array.isArray(subject)) {
    const values = Object.values(subject as Record<string, unknown>)
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim())
    const distinct = [...new Set(values)]
    return distinct.length === 0 ? EM_DASH : distinct.join(' · ')
  }
  return EM_DASH
}
