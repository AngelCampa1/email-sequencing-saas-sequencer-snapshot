/**
 * Human-friendly date formatting for the dashboard. The API returns ISO
 * timestamps; showing them raw, or with the browser's default
 * `toLocaleString()`, gives noisy, seconds-level, numeric-month strings that
 * read differently on every page. These helpers format dates the same way
 * everywhere: a spelled-out month so there is no day/month ambiguity, and no
 * seconds. Invalid or missing input renders as an em dash instead of
 * "Invalid Date".
 */

/** The dashboard's placeholder glyph for an empty or missing cell value. */
export const EM_DASH = '—'

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function toValidDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  // A bare 'YYYY-MM-DD' is parsed by `new Date()` as UTC midnight, which can
  // roll back to the previous day in negative-offset zones. Add a local-time
  // component so it stays the same calendar date everywhere.
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const date = new Date(`${value}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Short calendar date, e.g. "May 20, 2026". Empty/invalid input -> em dash. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toValidDate(value)
  return date ? date.toLocaleDateString('en-US', DATE_OPTIONS) : EM_DASH
}

/** Date with time but no seconds, e.g. "May 20, 2026, 10:00 AM". */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toValidDate(value)
  return date ? date.toLocaleString('en-US', DATE_TIME_OPTIONS) : EM_DASH
}
