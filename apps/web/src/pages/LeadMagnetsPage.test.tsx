import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadMagnetRow, ProductRow } from '../lib/types'
import { EditLeadMagnetDialog, LeadMagnetsPage, NewLeadMagnetDialog } from './LeadMagnetsPage'

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

const leadMagnet: LeadMagnetRow = {
  id: 'lm_1',
  product_id: 'prod_1',
  product_slug: 'camaudit',
  product_name: 'CAMAudit',
  slug: 'tenant-checklist',
  name: 'Tenant Checklist',
  asset_r2_bucket: 'camaudit-assets',
  asset_r2_key: 'tenant-checklist.pdf',
  effective_asset_r2_bucket: 'camaudit-assets',
  asset_status: 'available',
  asset_size: 1200,
  fulfillment_sequence_slug: 'tenant-welcome',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

const inactiveLm: LeadMagnetRow = {
  ...leadMagnet,
  id: 'lm_2',
  name: 'Old Guide',
  slug: 'old-guide',
  active: false,
  fulfillment_sequence_slug: null,
  asset_status: 'missing',
  asset_size: null,
  asset_r2_key: null,
  effective_asset_r2_bucket: null,
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
  lms?: LeadMagnetRow[]
  products?: ProductRow[]
  lmsError?: Error
  lmsLoading?: boolean
}) {
  mockUseQuery.mockImplementation((options) => {
    const key = (options as { queryKey: string[] }).queryKey[0]
    if (key === 'lead-magnets') {
      if (overrides?.lmsLoading) {
        return queryResult({ data: undefined, isLoading: true })
      }
      if (overrides?.lmsError) {
        return queryResult({ data: undefined, error: overrides.lmsError })
      }
      return queryResult({ data: overrides?.lms ?? [leadMagnet] })
    }
    if (key === 'products') {
      return queryResult({ data: overrides?.products ?? [product] })
    }
    return queryResult({ data: undefined })
  })
}

describe('LeadMagnetsPage loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders loading skeleton when lead magnets are loading', () => {
    setupQueries({ lmsLoading: true })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('animate-pulse')
    expect(markup).toContain('Lead Magnets')
  })
})

describe('LeadMagnetsPage error state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders error state when lead magnets fail to load', () => {
    setupQueries({ lmsError: new Error('D1 unavailable') })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Failed to load lead magnets')
    expect(markup).toContain('D1 unavailable')
  })

  it('keeps NewLeadMagnetDialog visible when lead magnets fail', () => {
    setupQueries({ lmsError: new Error('error') })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('New lead magnet')
  })
})

describe('LeadMagnetsPage empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders empty state when no lead magnets', () => {
    setupQueries({ lms: [] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('No lead magnets yet')
    expect(markup).toContain('A lead magnet is a free file')
  })
})

describe('LeadMagnetsPage success states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders lead magnet name and slug', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Tenant Checklist')
    expect(markup).toContain('tenant-checklist')
  })

  it('renders product name badge using product_name field', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('CAMAudit')
  })

  it('renders product name from productMap when product_name is absent', () => {
    const lmNoProductName: LeadMagnetRow = {
      ...leadMagnet,
      product_name: undefined,
    }
    setupQueries({ lms: [lmNoProductName] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('CAMAudit')
  })

  it('renders product_id as fallback when product not in productMap and product_name absent', () => {
    const lmNoProductName: LeadMagnetRow = {
      ...leadMagnet,
      product_id: 'unknown_prod',
      product_name: undefined,
    }
    setupQueries({ lms: [lmNoProductName], products: [] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('unknown_prod')
  })

  it('renders active badge for active lead magnet', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Active')
  })

  it('renders inactive badge for inactive lead magnet', () => {
    setupQueries({ lms: [inactiveLm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Inactive')
  })

  it('renders asset available status badge', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('File ready')
  })

  it('renders asset missing status badge', () => {
    setupQueries({ lms: [inactiveLm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('File missing')
  })

  it('renders bucket_unbound status badge', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_status: 'bucket_unbound' }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Storage not linked')
  })

  it('renders not_configured status badge when asset_status is undefined', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_status: undefined }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('No file yet')
  })

  it('renders not_configured status badge', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_status: 'not_configured' }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('No file yet')
  })

  it('renders unknown/probe-failed status badge', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_status: 'unknown' }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('File check failed')
  })

  it('renders asset R2 key when present', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('tenant-checklist.pdf')
  })

  it('renders "No file set" when asset_r2_key is null', () => {
    setupQueries({ lms: [inactiveLm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('No file set')
  })

  it('renders effective_asset_r2_bucket when present', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('camaudit-assets')
  })

  it('renders "No storage set" when no bucket', () => {
    const lm: LeadMagnetRow = {
      ...inactiveLm,
      asset_r2_bucket: null,
      effective_asset_r2_bucket: null,
    }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('No storage set')
  })

  it('renders asset size in bytes when small', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_size: 500 }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('500 B')
  })

  it('renders asset size in KB when between 1KB and 1MB', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_size: 2048 }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('2.0 KB')
  })

  it('renders asset size in MB when over 1MB', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_size: 2 * 1024 * 1024 }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('2.0 MB')
  })

  it('does not render size when asset_size is null', () => {
    const lm: LeadMagnetRow = { ...leadMagnet, asset_size: null }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).not.toContain(' B')
    expect(markup).not.toContain(' KB')
    expect(markup).not.toContain(' MB')
  })

  it('renders the follow-up sequence as a readable name, not a raw slug', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Tenant welcome')
    expect(markup).not.toContain('tenant-welcome')
  })

  it('renders "No follow-up email" when no fulfillment sequence', () => {
    setupQueries({ lms: [inactiveLm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('No follow-up email')
  })

  it('renders page description', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Free downloads you give to collect emails')
  })

  it('renders both Edit and Activate/Deactivate buttons', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Edit')
    expect(markup).toContain('Deactivate')
  })

  it('renders Activate button for inactive lead magnet', () => {
    setupQueries({ lms: [inactiveLm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Activate')
  })

  it('uses asset_r2_bucket when effective_asset_r2_bucket is null', () => {
    const lm: LeadMagnetRow = {
      ...leadMagnet,
      effective_asset_r2_bucket: null,
      asset_r2_bucket: 'fallback-bucket',
    }
    setupQueries({ lms: [lm] })
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('fallback-bucket')
  })
})

describe('LeadMagnetsPage products query failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('keeps lead magnets visible when products fail to load', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'lead-magnets') {
        return queryResult({ data: [leadMagnet] })
      }
      if (key === 'products') {
        return queryResult({ error: new Error('products unavailable') })
      }
      return queryResult({ data: undefined })
    })

    const markup = renderToStaticMarkup(<LeadMagnetsPage />)
    expect(markup).toContain('Tenant Checklist')
    expect(markup).toContain('File ready')
    expect(markup).not.toContain('Failed to load product labels')
  })
})

describe('EditLeadMagnetDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders as a function (is exported)', () => {
    expect(typeof EditLeadMagnetDialog).toBe('function')
  })

  it('renders the trigger button', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))
    const markup = renderToStaticMarkup(<EditLeadMagnetDialog lm={leadMagnet} />)
    expect(markup).toContain('Edit')
  })

  it('renders in pending state', () => {
    mockUseMutation.mockReturnValue(mutationResult({ isPending: true }))
    const markup = renderToStaticMarkup(<EditLeadMagnetDialog lm={leadMagnet} />)
    expect(markup).toContain('Edit')
  })

  it('calls onError with error message', () => {
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      return mutationResult({})
    })
    renderToStaticMarkup(<EditLeadMagnetDialog lm={leadMagnet} />)
    expect(capturedOnError).toBeDefined()
    capturedOnError?.(new Error('save failed'))
  })

  it('calls onError with fallback for non-Error', () => {
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      return mutationResult({})
    })
    renderToStaticMarkup(<EditLeadMagnetDialog lm={leadMagnet} />)
    capturedOnError?.('unknown error')
  })

  it('calls onSuccess handler', async () => {
    const { toast } = await import('sonner')
    let capturedOnSuccess: (() => Promise<void>) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnSuccess = (options as { onSuccess?: () => Promise<void> }).onSuccess
      return mutationResult({})
    })
    renderToStaticMarkup(<EditLeadMagnetDialog lm={leadMagnet} />)
    await capturedOnSuccess?.()
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Lead magnet updated')
  })
})

describe('NewLeadMagnetDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('renders as a function (is exported)', () => {
    expect(typeof NewLeadMagnetDialog).toBe('function')
  })

  it('renders the trigger button', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))
    const markup = renderToStaticMarkup(<NewLeadMagnetDialog products={[product]} />)
    expect(markup).toContain('New lead magnet')
  })

  it('renders with empty products list', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))
    const markup = renderToStaticMarkup(<NewLeadMagnetDialog products={[]} />)
    expect(markup).toContain('New lead magnet')
  })

  it('calls onError with error message', () => {
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      return mutationResult({})
    })
    renderToStaticMarkup(<NewLeadMagnetDialog products={[product]} />)
    capturedOnError?.(new Error('create failed'))
  })

  it('calls onError with fallback for non-Error', () => {
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      return mutationResult({})
    })
    renderToStaticMarkup(<NewLeadMagnetDialog products={[product]} />)
    capturedOnError?.('unknown')
  })

  it('calls onSuccess handler', async () => {
    const { toast } = await import('sonner')
    let capturedOnSuccess: (() => Promise<void>) | undefined
    mockUseMutation.mockImplementation((options) => {
      capturedOnSuccess = (options as { onSuccess?: () => Promise<void> }).onSuccess
      return mutationResult({})
    })
    renderToStaticMarkup(<NewLeadMagnetDialog products={[product]} />)
    await capturedOnSuccess?.()
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Lead magnet created')
  })
})

describe('ToggleActiveButton mutation callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
  })

  it('calls onSuccess for deactivate (active lead magnet)', async () => {
    const { toast } = await import('sonner')
    const capturedOnSuccess: Array<(() => Promise<void>) | undefined> = []
    mockUseMutation.mockImplementation((options) => {
      capturedOnSuccess.push((options as { onSuccess?: () => Promise<void> }).onSuccess)
      return mutationResult({})
    })
    setupQueries({ lms: [leadMagnet] })
    renderToStaticMarkup(<LeadMagnetsPage />)
    await capturedOnSuccess.find((handler) => handler?.toString().includes('deactivated'))?.()
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Lead magnet deactivated')
  })

  it('calls onSuccess for activate (inactive lead magnet)', async () => {
    const { toast } = await import('sonner')
    const capturedOnSuccess: Array<(() => Promise<void>) | undefined> = []
    mockUseMutation.mockImplementation((options) => {
      capturedOnSuccess.push((options as { onSuccess?: () => Promise<void> }).onSuccess)
      return mutationResult({})
    })
    setupQueries({ lms: [inactiveLm] })
    renderToStaticMarkup(<LeadMagnetsPage />)
    await capturedOnSuccess.find((handler) => handler?.toString().includes('activated'))?.()
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Lead magnet activated')
  })

  it('calls onError for toggle failure', async () => {
    const { toast } = await import('sonner')
    const capturedOnError: Array<((err: unknown) => void) | undefined> = []
    mockUseMutation.mockImplementation((options) => {
      capturedOnError.push((options as { onError?: (err: unknown) => void }).onError)
      return mutationResult({})
    })
    setupQueries()
    renderToStaticMarkup(<LeadMagnetsPage />)
    capturedOnError.find((handler) => handler?.toString().includes('toggle active state'))?.(
      new Error('toggle failed'),
    )
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('toggle failed')
  })

  it('uses fallback message when toggle error is not an Error', async () => {
    const { toast } = await import('sonner')
    const capturedOnError: Array<((err: unknown) => void) | undefined> = []
    mockUseMutation.mockImplementation((options) => {
      capturedOnError.push((options as { onError?: (err: unknown) => void }).onError)
      return mutationResult({})
    })
    setupQueries()
    renderToStaticMarkup(<LeadMagnetsPage />)
    capturedOnError.find((handler) => handler?.toString().includes('toggle active state'))?.(
      'unknown',
    )
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to toggle active state')
  })
})
