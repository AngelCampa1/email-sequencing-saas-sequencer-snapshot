import { describe, expect, it } from 'vitest'
import {
  auditActionLabel,
  auditTargetTypeLabel,
  formatPropertyValue,
  humanizeToken,
  membershipStatusLabel,
  productNameLabel,
  rotSequenceLabel,
  runStatusLabel,
  sequenceLabel,
  suppressionSourceLabel,
  templateKindLabel,
  templateLabel,
} from './labels'

describe('formatPropertyValue', () => {
  it('shows strings as-is', () => {
    expect(formatPropertyValue('Acme Corp')).toBe('Acme Corp')
  })

  it('renders booleans as Yes/No', () => {
    expect(formatPropertyValue(true)).toBe('Yes')
    expect(formatPropertyValue(false)).toBe('No')
  })

  it('formats numbers with separators', () => {
    expect(formatPropertyValue(12000)).toBe('12,000')
  })

  it('shows a dash for empty values', () => {
    expect(formatPropertyValue(null)).toBe('—')
    expect(formatPropertyValue(undefined)).toBe('—')
    expect(formatPropertyValue('')).toBe('—')
    expect(formatPropertyValue([])).toBe('—')
  })

  it('joins lists of simple values with commas', () => {
    expect(formatPropertyValue(['a', 'b', 'c'])).toBe('a, b, c')
  })

  it('falls back to compact JSON for nested objects', () => {
    expect(formatPropertyValue({ tier: 'gold' })).toBe('{"tier":"gold"}')
  })
})

describe('humanizeToken', () => {
  it('title-cases snake_case', () => {
    expect(humanizeToken('email_sent')).toBe('Email sent')
  })

  it('title-cases dotted event types', () => {
    expect(humanizeToken('email.opened')).toBe('Email opened')
  })

  it('title-cases kebab-case', () => {
    expect(humanizeToken('run-completed')).toBe('Run completed')
  })

  it('falls back to the raw token when empty after stripping', () => {
    expect(humanizeToken('_')).toBe('_')
  })
})

describe('runStatusLabel', () => {
  it.each([
    ['running', 'Running'],
    ['active', 'Running'],
    ['paused', 'Paused'],
    ['completed', 'Finished'],
    ['exited', 'Left early'],
    ['errored', 'Failed'],
  ])('maps %s -> %s', (input, expected) => {
    expect(runStatusLabel(input)).toBe(expected)
  })

  it('humanizes unknown statuses', () => {
    expect(runStatusLabel('weird_state')).toBe('Weird state')
  })
})

describe('membershipStatusLabel', () => {
  it.each([
    ['active', 'Active'],
    ['unsubscribed', 'Unsubscribed'],
    ['bounced', 'Bounced'],
    ['complained', 'Marked as spam'],
  ])('maps %s -> %s', (input, expected) => {
    expect(membershipStatusLabel(input)).toBe(expected)
  })

  it('humanizes unknown statuses', () => {
    expect(membershipStatusLabel('pending')).toBe('Pending')
  })
})

describe('suppressionSourceLabel', () => {
  it.each([
    ['manual', 'Added by hand'],
    ['webhook', 'Email provider'],
    ['list_import', 'Imported'],
    ['complaint', 'Marked as spam'],
    ['bounce', 'Bounced'],
    ['suppression', 'Provider list'],
    ['instantly_webhook', 'Cold outreach'],
  ])('maps %s -> %s', (input, expected) => {
    expect(suppressionSourceLabel(input)).toBe(expected)
  })

  it('humanizes unknown sources', () => {
    expect(suppressionSourceLabel('some_new_source')).toBe('Some new source')
  })
})

describe('auditActionLabel', () => {
  it.each([
    ['contact.blocked', 'Contact blocked'],
    ['enrollment.blocked', 'Sign-up blocked'],
    ['enrollment.created', 'Added to a sequence'],
    ['lead_magnet.downloaded', 'Free file downloaded'],
    ['contact.unsubscribed', 'Unsubscribed'],
    ['suppression.created', 'Added to the block list'],
    ['suppression.removed', 'Taken off the block list'],
    ['api_token.created', 'Access key made'],
  ])('maps %s -> %s', (input, expected) => {
    expect(auditActionLabel(input)).toBe(expected)
  })

  it('humanizes unknown action tokens', () => {
    expect(auditActionLabel('widget.zapped')).toBe('Widget zapped')
  })
})

describe('auditTargetTypeLabel', () => {
  it.each([
    ['contact', 'Contact'],
    ['enrollment', 'Sign-up'],
    ['sequence_run', 'Sequence'],
    ['lead_magnet', 'Free file'],
    ['suppression', 'Block list'],
    ['api_token', 'Access key'],
  ])('maps %s -> %s', (input, expected) => {
    expect(auditTargetTypeLabel(input)).toBe(expected)
  })

  it('humanizes unknown target type tokens', () => {
    expect(auditTargetTypeLabel('cron_job')).toBe('Cron job')
  })
})

describe('sequenceLabel', () => {
  it('title-cases a bare slug when no product is given', () => {
    expect(sequenceLabel('lead-magnet-nurture')).toBe('Lead magnet nurture')
  })

  it('drops the leading product slug when it matches', () => {
    expect(sequenceLabel('camaudit-white-label-pricing-sheet', 'camaudit')).toBe(
      'White label pricing sheet',
    )
  })

  it('drops a matching prefix from a list of product slugs', () => {
    expect(sequenceLabel('grantpipe-lead-magnet-nurture', ['camaudit', 'grantpipe'])).toBe(
      'Lead magnet nurture',
    )
  })

  it('keeps the full slug when no product prefix matches', () => {
    expect(sequenceLabel('welcome-series', 'camaudit')).toBe('Welcome series')
  })

  it('falls back to the full slug when it equals the product slug', () => {
    expect(sequenceLabel('camaudit', 'camaudit')).toBe('Camaudit')
  })
})

describe('productNameLabel', () => {
  it.each([
    ['camaudit', 'CAMAudit'],
    ['floriva-web', 'Floriva'],
    ['grantpipe', 'GrantPipe'],
  ])('maps the %s slug to its brand name', (slug, expected) => {
    expect(productNameLabel(slug)).toBe(expected)
  })

  it('title-cases an unknown product slug', () => {
    expect(productNameLabel('new-product')).toBe('New product')
  })

  it('leaves an already-cased name untouched', () => {
    expect(productNameLabel('AcmeMailer')).toBe('AcmeMailer')
  })
})

describe('rotSequenceLabel', () => {
  it('keeps the product with brand casing and plain sequence words', () => {
    expect(rotSequenceLabel('grantpipe-fulfillment-welcome')).toBe('GrantPipe fulfillment welcome')
  })

  it('uses correct brand casing for the product prefix', () => {
    expect(rotSequenceLabel('camaudit-bookkeeper-cam-checklist')).toBe(
      'CAMAudit bookkeeper cam checklist',
    )
  })

  it('title-cases a slug with no known product prefix', () => {
    expect(rotSequenceLabel('welcome-nurture')).toBe('Welcome nurture')
  })

  it('returns just the brand name when the slug is only the product', () => {
    expect(rotSequenceLabel('camaudit')).toBe('CAMAudit')
  })
})

describe('templateKindLabel', () => {
  it.each([
    ['react-email', 'Standard'],
    ['legacy-camaudit', 'Classic'],
  ])('maps %s -> %s', (input, expected) => {
    expect(templateKindLabel(input)).toBe(expected)
  })

  it('humanizes unknown kind tokens', () => {
    expect(templateKindLabel('mjml_v2')).toBe('Mjml v2')
  })
})

describe('templateLabel', () => {
  it('uses the last path segment of a path-style slug', () => {
    expect(templateLabel('legacy/camaudit/abstraction_step_1', 'camaudit')).toBe(
      'Abstraction step 1',
    )
  })

  it('drops the product prefix from the last segment', () => {
    expect(templateLabel('nurture/grantpipe-value-1', 'grantpipe')).toBe('Value 1')
  })

  it('handles a plain product-prefixed slug with no path', () => {
    expect(templateLabel('camaudit-welcome', 'camaudit')).toBe('Welcome')
  })

  it('title-cases a bare slug with no product prefix', () => {
    expect(templateLabel('welcome-email')).toBe('Welcome email')
  })
})
