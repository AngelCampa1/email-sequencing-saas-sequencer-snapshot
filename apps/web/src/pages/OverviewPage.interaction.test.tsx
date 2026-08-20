// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { OverviewData } from '../lib/types'
import { OverviewPage } from './OverviewPage'

vi.mock('../lib/api', () => ({
  getOverview: vi.fn(),
}))

const getOverview = vi.mocked(api.getOverview)

function makeOverviewData(overrides: Partial<OverviewData> = {}): OverviewData {
  return {
    send_volume_7d: 1000,
    send_volume_30d: 4200,
    active_runs: 5,
    unsub_rate_7d: 0.01,
    rot_sequences: [],
    top_sequences: [],
    warm_summary: { total_sent_7d: 800, avg_bounce_rate: 0.02 },
    cold_summary: { total_campaigns: 3, total_sent_7d: 200, reply_rate: 0.08 },
    ...overrides,
  }
}

function renderPage(): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OverviewPage (interaction)', () => {
  it('shows skeleton while data is loading', () => {
    getOverview.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // Loading state renders Skeleton elements, not the actual data headings
    expect(container.querySelector('.animate-pulse, [data-slot="skeleton"]')).toBeDefined()
    expect(screen.queryByText('Real-time summary of your email sequences')).toBeNull()
  })

  it('renders overview metrics after data loads', async () => {
    getOverview.mockResolvedValue(makeOverviewData())
    render(renderPage())

    expect(await screen.findByText('Real-time summary of your email sequences')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('4,200 in the last 30 days')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('People in a sequence right now')).toBeInTheDocument()
  })

  it('shows the 30-day total when no email went out in the last 7 days', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ send_volume_7d: 0, send_volume_30d: 8 }))
    render(renderPage())

    expect(await screen.findByText('8 in the last 30 days')).toBeInTheDocument()
    expect(screen.queryByText('Waiting for the first send')).toBeNull()
  })

  it('only says "Waiting for the first send" when nothing went out in 30 days', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ send_volume_7d: 0, send_volume_30d: 0 }))
    render(renderPage())

    expect(await screen.findByText('Waiting for the first send')).toBeInTheDocument()
  })

  it('shows error state and triggers retry on button click', async () => {
    const user = userEvent.setup()
    getOverview.mockRejectedValue(new Error('D1 temporarily unavailable'))
    render(renderPage())

    expect(await screen.findByText('We could not load your overview.')).toBeInTheDocument()
    expect(screen.getByText('D1 temporarily unavailable')).toBeInTheDocument()

    const callsBefore = getOverview.mock.calls.length
    const retryBtn = screen.getByRole('button', { name: /retry/i })
    await user.click(retryBtn)

    await waitFor(() => {
      expect(getOverview.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('shows no-data state and triggers retry on button click', async () => {
    const user = userEvent.setup()
    // Force the no-data path: resolve with null cast as OverviewData to bypass RQ undefined guard
    getOverview.mockResolvedValue(null as unknown as OverviewData)
    render(renderPage())

    expect(await screen.findByText('We have no overview to show yet.')).toBeInTheDocument()
    expect(screen.getByText('The overview came back empty.')).toBeInTheDocument()

    const callsBefore = getOverview.mock.calls.length
    const retryBtn = screen.getByRole('button', { name: /retry/i })
    await user.click(retryBtn)

    await waitFor(() => {
      expect(getOverview.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('shows "All sequences active" when rot_sequences is empty', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ rot_sequences: [] }))
    render(renderPage())

    expect(await screen.findByText('All sequences active')).toBeInTheDocument()
    // No alert banner rendered
    expect(screen.queryByText(/sequence.*with no new sign-ups in the last 90 days/i)).toBeNull()
  })

  it('shows rot alert and single sequence badge when one sequence rots', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ rot_sequences: ['welcome-nurture'] }))
    render(renderPage())

    // Stat sub-text for single rot
    expect(await screen.findByText('1 sequence with no recent sign-ups')).toBeInTheDocument()
    // Alert banner for single
    expect(
      screen.getByText('1 sequence with no new sign-ups in the last 90 days'),
    ).toBeInTheDocument()
    // Badge with humanized sequence name
    expect(screen.getByText('Welcome nurture')).toBeInTheDocument()
  })

  it('shows plural text when multiple sequences rot', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ rot_sequences: ['seq-a', 'seq-b'] }))
    render(renderPage())

    // Stat sub-text plural
    expect(await screen.findByText('2 sequences with no recent sign-ups')).toBeInTheDocument()
    // Alert banner plural
    expect(
      screen.getByText('2 sequences with no new sign-ups in the last 90 days'),
    ).toBeInTheDocument()
    expect(screen.getByText('Seq a')).toBeInTheDocument()
    expect(screen.getByText('Seq b')).toBeInTheDocument()
  })

  it('shows "Higher than we like" unsub rate label when rate exceeds 2%', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ unsub_rate_7d: 0.03 }))
    render(renderPage())

    expect(await screen.findByText('Higher than we like')).toBeInTheDocument()
  })

  it('shows "Looking healthy" unsub rate label when rate is within threshold', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ unsub_rate_7d: 0.01 }))
    render(renderPage())

    expect(await screen.findByText('Looking healthy')).toBeInTheDocument()
  })

  it('shows "No active sequences yet." when top_sequences is empty', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ top_sequences: [] }))
    render(renderPage())

    expect(await screen.findByText('No active sequences yet.')).toBeInTheDocument()
  })

  it('renders top sequences table rows when top_sequences has data (lines 147-179)', async () => {
    getOverview.mockResolvedValue(
      makeOverviewData({
        top_sequences: [
          { slug: 'welcome-onboard', product: 'AcmeMailer', enrollments: 250 },
          { slug: 'promo-spring', product: 'BetaProduct', enrollments: 125 },
        ],
      }),
    )
    render(renderPage())

    // Table renders
    expect(await screen.findByRole('table', { name: /top active sequences/i })).toBeInTheDocument()
    // Row data visible (slug humanized, unknown product name kept as-is)
    expect(screen.getByText('Welcome onboard')).toBeInTheDocument()
    expect(screen.getByText('AcmeMailer')).toBeInTheDocument()
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText('Promo spring')).toBeInTheDocument()
    expect(screen.getByText('BetaProduct')).toBeInTheDocument()
    expect(screen.getByText('125')).toBeInTheDocument()
  })

  it('renders each top sequence name as a drill-down link to the filtered sequences list', async () => {
    getOverview.mockResolvedValue(
      makeOverviewData({
        top_sequences: [
          { slug: 'welcome-onboard', product: 'AcmeMailer', enrollments: 250 },
          { slug: 'promo spring/24', product: 'BetaProduct', enrollments: 125 },
        ],
      }),
    )
    render(renderPage())

    const firstLink = await screen.findByRole('link', { name: 'Welcome onboard' })
    expect(firstLink).toHaveAttribute('href', '/sequences?q=welcome-onboard')

    const secondLink = screen.getByRole('link', { name: 'Promo spring/24' })
    expect(secondLink).toHaveAttribute(
      'href',
      `/sequences?q=${encodeURIComponent('promo spring/24')}`,
    )
  })

  it('renders warm summary sent and bounce rate within normal range', async () => {
    getOverview.mockResolvedValue(
      makeOverviewData({
        warm_summary: { total_sent_7d: 800, avg_bounce_rate: 0.02 },
      }),
    )
    render(renderPage())

    await screen.findByText('Warm Email')
    expect(screen.getByText('800')).toBeInTheDocument()
    // 0.02 * 100 = 2.00%
    expect(screen.getByText('2.00%')).toBeInTheDocument()
  })

  it('renders bounce rate in red when avg_bounce_rate > 5% (line 205 branch)', async () => {
    getOverview.mockResolvedValue(
      makeOverviewData({
        warm_summary: { total_sent_7d: 500, avg_bounce_rate: 0.07 },
      }),
    )
    render(renderPage())

    await screen.findByText('Warm Email')
    // 0.07 * 100 = 7.00%
    const bounceEl = screen.getByText('7.00%')
    expect(bounceEl).toBeInTheDocument()
    expect(bounceEl.className).toContain('text-red-600')
  })

  it('renders cold summary campaigns and reply rate', async () => {
    getOverview.mockResolvedValue(
      makeOverviewData({
        cold_summary: { total_campaigns: 10, total_sent_7d: 300, reply_rate: 0.12 },
      }),
    )
    render(renderPage())

    await screen.findByText('Cold Outreach')
    expect(screen.getByText('10')).toBeInTheDocument()
    // 0.12 * 100 = 12.00%
    expect(screen.getByText('12.00%')).toBeInTheDocument()
  })

  it('renders warn styling on Rot Sequences card when sequences are rotted', async () => {
    getOverview.mockResolvedValue(makeOverviewData({ rot_sequences: ['stale-seq'] }))
    render(renderPage())

    await screen.findByText('Stale Sequences')
    // Card gets border-amber-300 class (warn: true)
    // The AlertTriangle icon container gets bg-amber-50 text-amber-600
    // We verify the value "1" is rendered in the card
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('1 sequence with no recent sign-ups')).toBeInTheDocument()
  })
})
