import type { AuditEntry } from '../lib/types'

export function hasAuditChanges(entry: AuditEntry): boolean {
  return entry.before != null || entry.after != null
}
