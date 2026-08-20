import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../lib/types'
import { AuditRow } from './AuditPage'

function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit_1',
    actor: 'angel@example.com',
    action: 'updated',
    target_type: 'sequence',
    target_id: 'sequence_123456789',
    before: null,
    after: null,
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('AuditRow rendering', () => {
  it('marks expandable rows as keyboard-operable controls', () => {
    const markup = renderToStaticMarkup(
      <table>
        <tbody>
          <AuditRow entry={auditEntry({ before: { active: false }, after: { active: true } })} />
        </tbody>
      </table>,
    )

    expect(markup).toContain('<button')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls=')
    expect(markup).toContain('Show changes for audit entry audit_1')
  })

  it('does not put inert rows in the tab order', () => {
    const markup = renderToStaticMarkup(
      <table>
        <tbody>
          <AuditRow entry={auditEntry({ before: undefined, after: undefined })} />
        </tbody>
      </table>,
    )

    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('aria-expanded')
  })
})
