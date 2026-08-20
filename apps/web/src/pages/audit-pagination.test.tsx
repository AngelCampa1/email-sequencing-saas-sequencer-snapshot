import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEntry } from '../lib/types'
import { AuditPage } from './AuditPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

vi.mock('react-router', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}))

const mockUseQuery = vi.mocked(useQuery)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return value as unknown as ReturnType<typeof useQuery>
}

function auditEntry(index: number): AuditEntry {
  return {
    id: `audit_${index}`,
    actor: 'angel@example.com',
    action: 'updated',
    target_type: 'sequence',
    target_id: `seq_${index}`,
    before: null,
    after: null,
    at: '2026-05-20T10:00:00.000Z',
  }
}

describe('AuditPage pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables Next when the API says there is no next page even with 50 entries', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: {
          entries: Array.from({ length: 50 }, (_, index) => auditEntry(index + 1)),
          has_next: false,
        },
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(<AuditPage />)

    expect(markup).toContain('Page 1')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Next/)
  })

  it('enables Next when the API reports a following audit page', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: {
          entries: Array.from({ length: 50 }, (_, index) => auditEntry(index + 1)),
          has_next: true,
        },
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(<AuditPage />)
    const nextButton = markup.match(/<button[^>]*>Next/)?.[0] ?? ''

    expect(nextButton).not.toContain('disabled=""')
  })
})
