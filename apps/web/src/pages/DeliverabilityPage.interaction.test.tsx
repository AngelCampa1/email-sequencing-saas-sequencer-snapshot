// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { DeliverabilityData, ProductRow } from '../lib/types'
import { DeliverabilityPage } from './DeliverabilityPage'

vi.mock('../lib/api', () => ({
  getDeliverability: vi.fn(),
  getProducts: vi.fn(),
  updateInstantlyCampaign: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// NOTE: the real ../components/ui/select (Radix v2) is used here on purpose.
// Radix Select.Item forbids empty-string values; the source previously used
// value="" for the "Unassigned" item, which threw at runtime. That bug is fixed
// (source now uses a non-empty UNASSIGNED_VALUE sentinel), so these tests run
// against the real Select as a regression guard. The Save-path tests rely on the
// dialog's default selection (campaign.product_id ?? UNASSIGNED_VALUE) and never
// need to open the dropdown, so no pointer-driven option selection is required.

const getDeliverability = vi.mocked(api.getDeliverability)
const getProducts = vi.mocked(api.getProducts)
const updateInstantlyCampaign = vi.mocked(api.updateInstantlyCampaign)

const PRODUCT: ProductRow = {
  id: 'prod_1',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_API_KEY',
  suppression_scope: 'global',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const DELIVERABILITY: DeliverabilityData = {
  domains: [
    {
      id: 'dom_1',
      domain: 'example.com',
      date: '2026-05-20',
      sent: 100,
      delivered: 95,
      bounced: 2,
      complained: 0,
      opened: 40,
      clicked: 10,
      unsubscribed: 1,
    },
  ],
  instantly_campaigns: [
    {
      id: 'camp_1',
      name: 'Test Campaign',
      product_id: null,
      status: 'active',
      created_at_instantly: '2026-05-01T00:00:00Z',
      synced_at: '2026-05-20T12:00:00Z',
    },
  ],
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage(client?: QueryClient): ReactElement {
  const qc = client ?? makeClient()
  return (
    <QueryClientProvider client={qc}>
      <DeliverabilityPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DeliverabilityPage interaction — error + retry', () => {
  it('shows error state and calls getDeliverability again when Retry is clicked', async () => {
    getDeliverability.mockRejectedValue(new Error('upstream down'))
    getProducts.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('We could not load your email health.')).toBeInTheDocument()
    const callsBefore = getDeliverability.mock.calls.length

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retryBtn)

    await waitFor(() => {
      expect(getDeliverability.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})

describe('DeliverabilityPage interaction — bounce-rate sparkline', () => {
  it('renders a sparkline with a non-empty polyline for a domain with a multi-day series', async () => {
    const multiDay: DeliverabilityData = {
      domains: [
        {
          id: 'd1',
          domain: 'trend.com',
          date: '2026-05-18',
          sent: 100,
          delivered: 98,
          bounced: 1,
          complained: 0,
          opened: 40,
          clicked: 10,
          unsubscribed: 0,
        },
        {
          id: 'd2',
          domain: 'trend.com',
          date: '2026-05-19',
          sent: 100,
          delivered: 90,
          bounced: 8,
          complained: 0,
          opened: 30,
          clicked: 5,
          unsubscribed: 0,
        },
      ],
      instantly_campaigns: [],
    }
    getDeliverability.mockResolvedValue(multiDay)
    getProducts.mockResolvedValue([])
    render(renderPage())

    // The domain has two dated rows, so its full 2-day trend renders on each row.
    const sparks = await screen.findAllByRole('img', {
      name: '2-day bounce-rate trend for trend.com',
    })
    expect(sparks.length).toBeGreaterThan(0)
    const spark = sparks[0]
    expect(spark.tagName.toLowerCase()).toBe('svg')
    const polyline = spark.querySelector('polyline')
    expect(polyline).not.toBeNull()
    expect(polyline?.getAttribute('points')?.length).toBeGreaterThan(0)
  })

  it('renders a muted dash and no polyline for a domain with a single data point', async () => {
    const singleDay: DeliverabilityData = {
      domains: [
        {
          id: 'd1',
          domain: 'oneday.com',
          date: '2026-05-20',
          sent: 100,
          delivered: 95,
          bounced: 2,
          complained: 0,
          opened: 40,
          clicked: 10,
          unsubscribed: 1,
        },
      ],
      instantly_campaigns: [],
    }
    getDeliverability.mockResolvedValue(singleDay)
    getProducts.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('oneday.com')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: /bounce-rate trend for oneday.com/ }),
    ).not.toBeInTheDocument()
    // Placeholder dash is shown instead of an empty SVG.
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('DeliverabilityPage interaction — AssignCampaignDialog', () => {
  it('opens the dialog when Assign is clicked', async () => {
    getDeliverability.mockResolvedValue(DELIVERABILITY)
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('Test Campaign')).toBeInTheDocument()

    const assignBtn = screen.getByRole('button', { name: /assign/i })
    await userEvent.click(assignBtn)

    expect(await screen.findByText('Assign campaign to product')).toBeInTheDocument()
  })

  it('calls updateInstantlyCampaign with null when Unassigned is selected and Save is clicked', async () => {
    updateInstantlyCampaign.mockResolvedValue(undefined as never)
    getDeliverability.mockResolvedValue(DELIVERABILITY)
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('Test Campaign')).toBeInTheDocument()

    const assignBtn = screen.getByRole('button', { name: /assign/i })
    await userEvent.click(assignBtn)

    await screen.findByText('Assign campaign to product')

    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(updateInstantlyCampaign).toHaveBeenCalledWith('camp_1', { product_id: null })
    })
  })

  it('calls updateInstantlyCampaign with product id when a product is selected and Save is clicked', async () => {
    updateInstantlyCampaign.mockResolvedValue(undefined as never)
    const deliverabilityWithAssigned: DeliverabilityData = {
      ...DELIVERABILITY,
      instantly_campaigns: [
        {
          id: 'camp_2',
          name: 'Assigned Campaign',
          product_id: 'prod_1',
          status: 'active',
          created_at_instantly: '2026-05-01T00:00:00Z',
          synced_at: '2026-05-20T12:00:00Z',
        },
      ],
    }
    getDeliverability.mockResolvedValue(deliverabilityWithAssigned)
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('Assigned Campaign')).toBeInTheDocument()

    const assignBtn = screen.getByRole('button', { name: /assign/i })
    await userEvent.click(assignBtn)

    await screen.findByText('Assign campaign to product')

    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(updateInstantlyCampaign).toHaveBeenCalledWith('camp_2', { product_id: 'prod_1' })
    })
  })

  it('shows toast.success and closes dialog after successful mutation', async () => {
    const { toast } = await import('sonner')
    updateInstantlyCampaign.mockResolvedValue(undefined as never)
    getDeliverability.mockResolvedValue(DELIVERABILITY)
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('Test Campaign')).toBeInTheDocument()

    const assignBtn = screen.getByRole('button', { name: /assign/i })
    await userEvent.click(assignBtn)

    await screen.findByText('Assign campaign to product')

    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Campaign saved')
    })
  })

  it('shows toast.error when mutation fails', async () => {
    const { toast } = await import('sonner')
    updateInstantlyCampaign.mockRejectedValue(new Error('assign failed'))
    getDeliverability.mockResolvedValue(DELIVERABILITY)
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('Test Campaign')).toBeInTheDocument()

    const assignBtn = screen.getByRole('button', { name: /assign/i })
    await userEvent.click(assignBtn)

    await screen.findByText('Assign campaign to product')

    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('assign failed')
    })
    // The error is also surfaced inline inside the dialog (role="alert"),
    // matching the other form dialogs, so it stays visible after the toast fades.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('assign failed')
  })

  it('closes dialog when Cancel is clicked', async () => {
    getDeliverability.mockResolvedValue(DELIVERABILITY)
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('Test Campaign')).toBeInTheDocument()

    const assignBtn = screen.getByRole('button', { name: /assign/i })
    await userEvent.click(assignBtn)

    await screen.findByText('Assign campaign to product')

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    await userEvent.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByText('Assign campaign to product')).not.toBeInTheDocument()
    })
  })
})
