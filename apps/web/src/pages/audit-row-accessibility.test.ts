import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../lib/types'
import { hasAuditChanges } from './audit-row-accessibility'

function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit_1',
    actor: 'angel@example.com',
    action: 'updated',
    target_type: 'sequence',
    target_id: 'seq_1',
    before: null,
    after: null,
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('audit row accessibility helpers', () => {
  it('only treats present before or after snapshots as expandable changes', () => {
    expect(hasAuditChanges(auditEntry())).toBe(false)
    expect(hasAuditChanges(auditEntry({ before: undefined, after: undefined }))).toBe(false)
    expect(hasAuditChanges(auditEntry({ before: { active: false } }))).toBe(true)
    expect(hasAuditChanges(auditEntry({ after: { active: true } }))).toBe(true)
  })
})
