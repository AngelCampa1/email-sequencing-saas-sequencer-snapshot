import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverviewData } from '../lib/types'
import { OverviewPage } from './OverviewPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

const mockUseQuery = vi.mocked(useQuery)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return value as unknown as ReturnType<typeof useQuery>
}

function overviewData(overrides: Partial<OverviewData> = {}): OverviewData {
  return {
    send_volume_7d: 0,
    send_volume_30d: 0,
    active_runs: 0,
    unsub_rate_7d: 0,
    rot_sequences: [],
    top_sequences: [],
    warm_summary: { total_sent_7d: 0, avg_bounce_rate: 0 },
    cold_summary: { total_campaigns: 0, total_sent_7d: 0, reply_rate: 0 },
    ...overrides,
  }
}

describe('OverviewPage rot copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('describes healthy rot status as all sequences active', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: overviewData(),
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(<OverviewPage />)

    expect(markup).toContain('All sequences active')
    expect(markup).not.toContain('All up to date')
    expect(markup).not.toContain('Recently enrolled')
  })

  it('describes rot alerts as missing enrollments in the last 90 days', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: overviewData({ rot_sequences: ['welcome-nurture'] }),
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(<OverviewPage />)

    expect(markup).toContain('1 sequence with no new sign-ups in the last 90 days')
    expect(markup).not.toContain('not updated in 90+ days')
  })

  it('renders recoverable query errors with a retry action', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: undefined,
        isLoading: false,
        error: new Error('D1 temporarily unavailable'),
        refetch: vi.fn(),
        isFetching: false,
      }),
    )

    const markup = renderToStaticMarkup(<OverviewPage />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('We could not load your overview.')
    expect(markup).toContain('D1 temporarily unavailable')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('We could not load your overview.:')
  })

  it('renders a recoverable alert when overview data is unavailable without an error', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    )

    const markup = renderToStaticMarkup(<OverviewPage />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('We have no overview to show yet.')
    expect(markup).toContain('The overview came back empty.')
    expect(markup).toContain('Retry')
  })
})
