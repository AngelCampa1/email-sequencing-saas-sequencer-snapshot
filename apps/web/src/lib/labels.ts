/**
 * Human-readable labels for the raw status/event/kind tokens that come back
 * from the API. The dashboard should never show snake_case enum values to a
 * non-technical user. Unknown tokens fall back to a title-cased version of the
 * raw string so we never render an empty or broken label.
 */

/**
 * Title-case a token that uses `_`, `-`, or `.` as separators.
 * e.g. "email_sent" -> "Email sent", "email.opened" -> "Email opened".
 */
export function humanizeToken(token: string): string {
  const spaced = token.replace(/[_.-]+/g, ' ').trim()
  if (spaced === '') return token
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Label for a sequence run's lifecycle status. */
const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  active: 'Running',
  paused: 'Paused',
  completed: 'Finished',
  exited: 'Left early',
  errored: 'Failed',
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? humanizeToken(status)
}

/** Label for a contact's membership status with a product. */
const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  unsubscribed: 'Unsubscribed',
  bounced: 'Bounced',
  complained: 'Marked as spam',
}

export function membershipStatusLabel(status: string): string {
  return MEMBERSHIP_STATUS_LABELS[status] ?? humanizeToken(status)
}

/** Label for where a suppression came from. */
const SUPPRESSION_SOURCE_LABELS: Record<string, string> = {
  manual: 'Added by hand',
  webhook: 'Email provider',
  list_import: 'Imported',
  complaint: 'Marked as spam',
  bounce: 'Bounced',
  suppression: 'Provider list',
  instantly_webhook: 'Cold outreach',
}

export function suppressionSourceLabel(source: string): string {
  return SUPPRESSION_SOURCE_LABELS[source] ?? humanizeToken(source)
}

/** Plain-English label for an audit action token. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  'contact.blocked': 'Contact blocked',
  'enrollment.blocked': 'Sign-up blocked',
  'enrollment.created': 'Added to a sequence',
  'lead_magnet.downloaded': 'Free file downloaded',
  'contact.unsubscribed': 'Unsubscribed',
  'suppression.created': 'Added to the block list',
  'suppression.removed': 'Taken off the block list',
  'api_token.created': 'Access key made',
}
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? humanizeToken(action)
}

/** Plain-English label for what an audit entry changed. */
const AUDIT_TARGET_LABELS: Record<string, string> = {
  contact: 'Contact',
  enrollment: 'Sign-up',
  sequence_run: 'Sequence',
  lead_magnet: 'Free file',
  suppression: 'Block list',
  api_token: 'Access key',
}
export function auditTargetTypeLabel(targetType: string): string {
  return AUDIT_TARGET_LABELS[targetType] ?? humanizeToken(targetType)
}

/**
 * Friendly name for a sequence built from its slug. The slug is the only
 * identifier the system stores, so we title-case it for display. When the
 * owning product slug is known we drop it from the front, since the product
 * is already shown next to the sequence.
 * e.g. ("camaudit-white-label-pricing-sheet", "camaudit") -> "White label pricing sheet".
 */
export function sequenceLabel(slug: string, productSlug?: string | string[] | null): string {
  const candidates = Array.isArray(productSlug) ? productSlug : productSlug ? [productSlug] : []
  let rest = slug
  for (const ps of candidates) {
    if (ps && (slug === ps || slug.startsWith(`${ps}-`))) {
      rest = slug.slice(ps.length)
      break
    }
  }
  const humanized = humanizeToken(rest)
  return humanized.trim() === '' ? humanizeToken(slug) : humanized
}

/**
 * Brand display name for a Ventora product slug. The dashboard sometimes only
 * has the lowercase product slug (e.g. on the Overview top-sequences table), so
 * we map it to the correct brand casing. Unknown slugs fall back to a
 * title-cased version so a newly added product still reads cleanly.
 */
const PRODUCT_NAME_LABELS: Record<string, string> = {
  camaudit: 'CAMAudit',
  'floriva-web': 'Floriva',
  grantpipe: 'GrantPipe',
}
export function productNameLabel(slug: string): string {
  return PRODUCT_NAME_LABELS[slug] ?? humanizeToken(slug)
}

const KNOWN_PRODUCT_SLUGS = Object.keys(PRODUCT_NAME_LABELS)

/**
 * Label for a bare sequence slug that may carry a product prefix, used where no
 * separate product column is shown (e.g. the Overview stale-sequences list).
 * Keeps the product for context but with correct brand casing, then the rest of
 * the sequence in plain words.
 * e.g. "camaudit-tenant-checklist" -> "CAMAudit tenant checklist".
 */
export function rotSequenceLabel(slug: string): string {
  const ps = KNOWN_PRODUCT_SLUGS.find((p) => slug === p || slug.startsWith(`${p}-`))
  if (!ps) return humanizeToken(slug)
  const rest = slug.slice(ps.length).replace(/^[_.-]+/, '')
  if (rest === '') return productNameLabel(ps)
  return `${productNameLabel(ps)} ${rest.replace(/[_.-]+/g, ' ')}`
}

/**
 * Render an arbitrary contact-property value as a short, readable string for a
 * non-technical reader. Contacts can carry free-form properties (booleans,
 * numbers, lists, nested objects), and a raw JSON blob reads like a developer
 * dump. Primitives show plainly, booleans become Yes/No, empty values become a
 * dash, lists of primitives join with commas, and anything still structured
 * falls back to compact JSON so the value is never lost.
 */
export function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    const allPrimitive = value.every(
      (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
    )
    if (allPrimitive) return value.map((v) => formatPropertyValue(v)).join(', ')
  }
  return JSON.stringify(value)
}

/**
 * Friendly name for an email template built from its slug. Template slugs are
 * often path-style (e.g. "legacy/camaudit/abstraction_step_1" or
 * "lead-magnets/tenant-checklist-delivery"), where the leading segments repeat
 * the engine and product that are already shown in their own columns. We take
 * the last path segment as the meaningful name, drop any product prefix on it,
 * then title-case the rest. The full slug stays visible beneath the name as the
 * canonical id. e.g. "legacy/camaudit/abstraction_step_1" -> "Abstraction step 1".
 */
export function templateLabel(slug: string, productSlug?: string | null): string {
  const lastSegment = slug.split('/').pop() ?? slug
  const base = lastSegment.trim() === '' ? slug : lastSegment
  return sequenceLabel(base, productSlug)
}

/** Plain-English label for a template engine kind. */
const TEMPLATE_KIND_LABELS: Record<string, string> = {
  'react-email': 'Standard',
  'legacy-camaudit': 'Classic',
}
export function templateKindLabel(kind: string): string {
  return TEMPLATE_KIND_LABELS[kind] ?? humanizeToken(kind)
}
