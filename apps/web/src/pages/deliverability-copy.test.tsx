import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeliverabilityPage } from './DeliverabilityPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockUseQuery = vi.mocked(useQuery)
const mockUseMutation = vi.mocked(useMutation)
const mockUseQueryClient = vi.mocked(useQueryClient)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return value as unknown as ReturnType<typeof useQuery>
}

function deliverabilityResult(data: unknown) {
  return queryResult({
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  })
}

function mockDeliverabilityQuery(deliverabilityData: unknown) {
  mockUseQuery.mockImplementation((options) => {
    const key = (options as { queryKey: unknown[] }).queryKey[0]
    if (key === 'deliverability') return deliverabilityResult(deliverabilityData)
    if (key === 'products') return queryResult({ data: [], isLoading: false, error: null })
    return queryResult({ data: undefined, isLoading: false, error: null })
  })
}

function domainRow(domain: string) {
  return {
    id: domain,
    domain,
    date: '2026-05-20',
    sent: 10,
    delivered: 10,
    bounced: 0,
    complained: 0,
    opened: 5,
  }
}

describe('DeliverabilityPage copy and query states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('shows only the error state when deliverability data fails to load', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: unknown[] }).queryKey[0]
      if (key === 'deliverability') {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: new Error('upstream unavailable'),
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({ data: [], isLoading: false, error: null })
    })

    const markup = renderToStaticMarkup(<DeliverabilityPage />)

    expect(markup).toContain('We could not load your email health.')
    expect(markup).toContain('upstream unavailable')
    expect(markup).not.toContain('No domain health yet')
    expect(markup).not.toContain('No cold outreach campaigns yet')
  })

  it('describes domain health as data that fills in daily', () => {
    mockDeliverabilityQuery({ domains: [], instantly_campaigns: [] })

    const markup = renderToStaticMarkup(<DeliverabilityPage />)

    expect(markup).toContain('No domain health yet')
    expect(markup).toContain('fills in each day')
    expect(markup).not.toContain('Resend webhooks will populate this table')
  })

  it('does not claim empty Instantly data only means the API key is missing', () => {
    mockDeliverabilityQuery({ domains: [], instantly_campaigns: [] })

    const markup = renderToStaticMarkup(<DeliverabilityPage />)

    expect(markup).toContain('No cold outreach campaigns yet')
    expect(markup).toContain('We pull these from Instantly every hour')
    expect(markup).not.toContain('once INSTANTLY_API_KEY is configured')
  })

  it('shows the CAMAudit warming callout for the canonical domain case-insensitively', () => {
    mockDeliverabilityQuery({ domains: [domainRow('CAMAudit.io')], instantly_campaigns: [] })

    const markup = renderToStaticMarkup(<DeliverabilityPage />)

    expect(markup).toContain('Watch your new domain')
    expect(markup).toContain('This domain is new. Send slowly.')
  })

  it('does not show the CAMAudit warming callout for unrelated domains containing the name', () => {
    mockDeliverabilityQuery({
      domains: [domainRow('notcamaudit.example')],
      instantly_campaigns: [],
    })

    const markup = renderToStaticMarkup(<DeliverabilityPage />)

    expect(markup).not.toContain('Watch your new domain')
  })
})
