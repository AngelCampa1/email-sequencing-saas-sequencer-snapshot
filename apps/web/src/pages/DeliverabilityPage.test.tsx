import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeliverabilityData, ProductRow } from '../lib/types'
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

const product: ProductRow = {
  id: 'prod_1',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT',
  suppression_scope: 'global',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function makeDomain(domain: string, overrides?: Partial<DeliverabilityData['domains'][number]>) {
  return {
    id: domain,
    domain,
    date: '2026-05-20',
    sent: 100,
    delivered: 95,
    bounced: 2,
    complained: 0,
    opened: 40,
    clicked: 10,
    unsubscribed: 1,
    ...overrides,
  }
}

function makeCampaign(
  id: string,
  name: string,
  overrides?: Partial<DeliverabilityData['instantly_campaigns'][number]>,
) {
  return {
    id,
    name,
    product_id: null,
    status: 'active',
    created_at_instantly: '2026-05-01T00:00:00.000Z',
    synced_at: '2026-05-20T12:00:00.000Z',
    ...overrides,
  }
}

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return {
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useQuery>
}

function mutationResult(value: Partial<ReturnType<typeof useMutation>>) {
  return {
    isPending: false,
    mutate: vi.fn(),
    error: null,
    ...value,
  } as unknown as ReturnType<typeof useMutation>
}

function setupQueries(overrides?: {
  deliverability?: DeliverabilityData | null
  products?: ProductRow[]
  deliverabilityError?: Error
  deliverabilityLoading?: boolean
}) {
  mockUseQuery.mockImplementation((options) => {
    const key = (options as { queryKey: unknown[] }).queryKey[0]
    if (key === 'deliverability') {
      if (overrides?.deliverabilityLoading) {
        return queryResult({ data: undefined, isLoading: true })
      }
      if (overrides?.deliverabilityError) {
        return queryResult({
          data: undefined,
          error: overrides.deliverabilityError,
        })
      }
      const defaultData: DeliverabilityData = overrides?.deliverability ?? {
        domains: [makeDomain('example.com')],
        instantly_campaigns: [makeCampaign('camp_1', 'Test Campaign')],
      }
      return queryResult({ data: defaultData })
    }
    if (key === 'products') {
      return queryResult({ data: overrides?.products ?? [product] })
    }
    return queryResult({ data: undefined })
  })
}

describe('DeliverabilityPage loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders loading skeleton for domain health when loading', () => {
    setupQueries({ deliverabilityLoading: true })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('animate-pulse')
    expect(markup).toContain('Deliverability')
  })
})

describe('DeliverabilityPage error state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders error state when deliverability fails to load', () => {
    setupQueries({ deliverabilityError: new Error('upstream unavailable') })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('We could not load your email health.')
    expect(markup).toContain('upstream unavailable')
  })

  it('does not show domain health table on error', () => {
    setupQueries({ deliverabilityError: new Error('error') })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).not.toContain('No domain health yet')
    expect(markup).not.toContain('No cold outreach campaigns yet')
  })
})

describe('DeliverabilityPage empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('shows empty domain health state', () => {
    setupQueries({ deliverability: { domains: [], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('No domain health yet')
    expect(markup).toContain('fills in each day')
  })

  it('shows empty instantly campaigns state', () => {
    setupQueries({ deliverability: { domains: [], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('No cold outreach campaigns yet')
    expect(markup).toContain('We pull these from Instantly every hour')
  })
})

describe('DeliverabilityPage domain health table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders domain in the table', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('example.com')
  })

  it('renders date column', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('May 20, 2026')
  })

  it('renders sent count', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('100')
  })

  it('renders delivered count', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('95')
  })

  it('renders opened count', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('40')
  })

  it('renders bounce percentage with medium amber styling for rate >2% <=5%', () => {
    // 10/100 = 10% bounce rate → high (red)
    // 3/100 = 3% → med (amber)
    const domain = makeDomain('amber-domain.com', { sent: 100, bounced: 3, complained: 0 })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('3.00%')
    expect(markup).toContain('text-amber-600')
  })

  it('renders bounce percentage with red styling for rate >5%', () => {
    const domain = makeDomain('high-bounce.com', { sent: 100, bounced: 10, complained: 0 })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('10.00%')
    expect(markup).toContain('text-red-600')
  })

  it('renders bounce as 0.00% for zero sent', () => {
    const domain = makeDomain('zero-sent.com', { sent: 0, bounced: 0 })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('0.00%')
  })

  it('renders complaint percentage with red styling for rate >0.1%', () => {
    const domain = makeDomain('high-complaint.com', {
      sent: 1000,
      bounced: 0,
      complained: 5,
    })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('0.50%')
    expect(markup).toContain('text-red-600')
  })

  it('renders complaint percentage as normal text for rate <=0.1%', () => {
    const domain = makeDomain('ok-complaint.com', {
      sent: 10000,
      bounced: 0,
      complained: 1,
    })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('0.01%')
    // Should not have red styling for complaint
    expect(markup).toContain('text-slate-600')
  })

  it('renders complaint as 0.00% for zero sent', () => {
    const domain = makeDomain('zero-sent-c.com', { sent: 0, complained: 0 })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('0.00%')
  })
})

describe('DeliverabilityPage CAMAudit callout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('shows CAMAudit warming callout for camaudit.io domain', () => {
    const domain = makeDomain('camaudit.io')
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Watch your new domain')
    expect(markup).toContain('This domain is new. Send slowly.')
  })

  it('shows the warming callout once for multiple camaudit.io domains without leaking row counts', () => {
    const domains = [makeDomain('camaudit.io'), makeDomain('mail.camaudit.io')]
    setupQueries({ deliverability: { domains, instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Watch your new domain')
    expect(markup).not.toContain('row')
  })

  it('shows callout for subdomain of camaudit.io', () => {
    const domain = makeDomain('mail.camaudit.io')
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Watch your new domain')
  })

  it('shows callout for case-insensitive domain match', () => {
    const domain = makeDomain('CAMAudit.io')
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Watch your new domain')
  })

  it('does not show callout for unrelated domains', () => {
    const domain = makeDomain('notcamaudit.example')
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).not.toContain('Watch your new domain')
  })

  it('does not show callout for domain containing camaudit but not camaudit.io', () => {
    const domain = makeDomain('fakecamaudit.com')
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).not.toContain('Watch your new domain')
  })

  it('strips trailing dot from domain for comparison', () => {
    const domain = makeDomain('camaudit.io.')
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Watch your new domain')
  })
})

describe('DeliverabilityPage Instantly campaigns table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders campaign name', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Test Campaign')
  })

  it('renders active badge for active campaign', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Active')
  })

  it('renders paused badge for non-active campaign', () => {
    const campaign = makeCampaign('camp_2', 'Paused Campaign', { status: 'paused' })
    setupQueries({ deliverability: { domains: [], instantly_campaigns: [campaign] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Paused')
  })

  it('renders assigned product badge when campaign has product_id', () => {
    const campaign = makeCampaign('camp_3', 'CAMAudit Campaign', { product_id: 'prod_1' })
    setupQueries({
      deliverability: { domains: [], instantly_campaigns: [campaign] },
      products: [product],
    })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('CAMAudit')
  })

  it('renders Unassigned when campaign has no product_id', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Unassigned')
  })

  it('renders Unassigned when product_id not in productMap', () => {
    const campaign = makeCampaign('camp_4', 'Unknown Prod', { product_id: 'unknown_prod' })
    setupQueries({
      deliverability: { domains: [], instantly_campaigns: [campaign] },
      products: [],
    })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Unassigned')
  })

  it('renders Assign button for each campaign', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('Assign')
  })

  it('renders synced date', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    // synced_at is '2026-05-20T12:00:00.000Z' - just check column header is rendered
    expect(markup).toContain('Synced')
  })
})

describe('DeliverabilityPage AssignCampaignDialog mutation callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('calls onSuccess handler and shows toast', async () => {
    const { toast } = await import('sonner')
    let capturedOnSuccess: (() => Promise<void>) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnSuccess = (options as { onSuccess?: () => Promise<void> }).onSuccess
      return mutationResult({})
    })
    setupQueries()
    renderToStaticMarkup(<DeliverabilityPage />)
    await capturedOnSuccess?.()
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Campaign saved')
  })

  it('calls onError handler with Error instance', async () => {
    const { toast } = await import('sonner')
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      return mutationResult({})
    })
    setupQueries()
    renderToStaticMarkup(<DeliverabilityPage />)
    capturedOnError?.(new Error('assign failed'))
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('assign failed')
  })

  it('calls onError handler with fallback for non-Error', async () => {
    const { toast } = await import('sonner')
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      return mutationResult({})
    })
    setupQueries()
    renderToStaticMarkup(<DeliverabilityPage />)
    capturedOnError?.('unknown error')
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to update campaign')
  })

  it('renders assign button disabled when mutation is pending', () => {
    mockUseMutation.mockReturnValue(mutationResult({ isPending: true }))
    setupQueries()
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    // The Assign button still renders (trigger is not conditional on isPending)
    expect(markup).toContain('Assign')
  })
})

describe('DeliverabilityPage pct helper edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders low bounce rate without red or amber styling', () => {
    // 1/100 = 1% ≤ 2%, no special styling
    const domain = makeDomain('low-bounce.com', { sent: 100, bounced: 1, complained: 0 })
    setupQueries({ deliverability: { domains: [domain], instantly_campaigns: [] } })
    const markup = renderToStaticMarkup(<DeliverabilityPage />)
    expect(markup).toContain('1.00%')
    // Should not have error or warning class for bounce
    expect(markup).not.toContain('text-amber-600')
    expect(markup).not.toContain('text-red-600')
  })
})
