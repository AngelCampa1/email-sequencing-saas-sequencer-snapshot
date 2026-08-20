import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductRow, SuppressionRow } from '../lib/types'
import {
  addSuppressionFormReducer,
  buildSuppressionProductOptions,
  canSubmitAddSuppression,
  initialAddSuppressionFormState,
  SuppressionsPage,
} from './SuppressionsPage'

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('react-router', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getSuppressions: vi.fn(),
    getProducts: vi.fn(),
    addSuppression: vi.fn(),
    removeSuppression: vi.fn(),
  }
})

const mockUseQuery = vi.mocked(useQuery)
const mockUseMutation = vi.mocked(useMutation)
const mockUseQueryClient = vi.mocked(useQueryClient)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return value as unknown as ReturnType<typeof useQuery>
}

function suppressionScopeFromKey(key: unknown[]): string | undefined {
  if (key[0] !== 'suppressions') return undefined
  const params = key[1]
  if (params && typeof params === 'object' && 'scope' in params) {
    return (params as { scope?: string }).scope
  }
  return undefined
}

const product: ProductRow = {
  id: 'prod_camaudit',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT',
  suppression_scope: 'product',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const globalSuppression: SuppressionRow = {
  id: 'supp_global_1',
  email: 'global@example.com',
  scope: 'global',
  product_id: null,
  reason: 'manual',
  source: 'manual',
  created_at: '2026-05-20T10:00:00.000Z',
}

const productSuppression: SuppressionRow = {
  id: 'supp_product_1',
  email: 'product@example.com',
  scope: 'product',
  product_id: 'prod_camaudit',
  reason: null,
  source: 'bounce',
  created_at: '2026-05-21T09:00:00.000Z',
}

const complaintSuppression: SuppressionRow = {
  id: 'supp_complaint',
  email: 'complainer@example.com',
  scope: 'global',
  product_id: null,
  reason: 'spam report',
  source: 'complaint',
  created_at: '2026-05-22T08:00:00.000Z',
}

const webhookSuppression: SuppressionRow = {
  id: 'supp_webhook',
  email: 'webhook@example.com',
  scope: 'product',
  product_id: 'prod_camaudit',
  reason: null,
  source: 'webhook',
  created_at: '2026-05-23T07:00:00.000Z',
}

function setupQueries(overrides?: {
  globalData?: SuppressionRow[] | null
  productData?: SuppressionRow[] | null
  products?: ProductRow[]
  globalError?: Error
  productError?: Error
  globalLoading?: boolean
  productLoading?: boolean
}) {
  mockUseQuery.mockImplementation((options) => {
    const key = (options as { queryKey: unknown[] }).queryKey
    const scope = suppressionScopeFromKey(key)
    if (key[0] === 'products') {
      return queryResult({
        data: overrides?.products ?? [product],
        isLoading: false,
        error: null,
      })
    }
    if (scope === 'global') {
      if (overrides?.globalLoading) {
        return queryResult({ data: undefined, isLoading: true, error: null })
      }
      if (overrides?.globalError) {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: overrides.globalError,
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({
        data: overrides?.globalData ?? [globalSuppression],
        isLoading: false,
        error: null,
      })
    }
    if (scope === 'product') {
      if (overrides?.productLoading) {
        return queryResult({ data: undefined, isLoading: true, error: null })
      }
      if (overrides?.productError) {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: overrides.productError,
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({
        data: overrides?.productData ?? [productSuppression],
        isLoading: false,
        error: null,
      })
    }
    return queryResult({ data: undefined, isLoading: false, error: null })
  })
}

describe('addSuppressionFormReducer', () => {
  it('initial state is correct', () => {
    expect(initialAddSuppressionFormState).toEqual({
      email: '',
      scope: 'global',
      productId: '',
      reason: '',
      submitError: null,
    })
  })

  it('setEmail updates email', () => {
    const result = addSuppressionFormReducer(initialAddSuppressionFormState, {
      type: 'setEmail',
      value: 'user@example.com',
    })
    expect(result.email).toBe('user@example.com')
  })

  it('setScope updates scope', () => {
    const result = addSuppressionFormReducer(initialAddSuppressionFormState, {
      type: 'setScope',
      value: 'product',
    })
    expect(result.scope).toBe('product')
  })

  it('setProductId updates productId', () => {
    const result = addSuppressionFormReducer(initialAddSuppressionFormState, {
      type: 'setProductId',
      value: 'prod_1',
    })
    expect(result.productId).toBe('prod_1')
  })

  it('setReason updates reason', () => {
    const result = addSuppressionFormReducer(initialAddSuppressionFormState, {
      type: 'setReason',
      value: 'Manual request',
    })
    expect(result.reason).toBe('Manual request')
  })

  it('dialogOpened clears submitError', () => {
    const state = { ...initialAddSuppressionFormState, submitError: 'some error' }
    const result = addSuppressionFormReducer(state, { type: 'dialogOpened' })
    expect(result.submitError).toBeNull()
  })

  it('dialogClosed resets to initial state', () => {
    const state = {
      email: 'user@example.com',
      scope: 'product' as const,
      productId: 'prod_1',
      reason: 'manual',
      submitError: 'failed',
    }
    const result = addSuppressionFormReducer(state, { type: 'dialogClosed' })
    expect(result).toEqual(initialAddSuppressionFormState)
  })

  it('submitSucceeded resets to initial state', () => {
    const state = {
      email: 'user@example.com',
      scope: 'product' as const,
      productId: 'prod_1',
      reason: 'manual',
      submitError: null,
    }
    const result = addSuppressionFormReducer(state, { type: 'submitSucceeded' })
    expect(result).toEqual(initialAddSuppressionFormState)
  })

  it('submitFailed sets submitError', () => {
    const result = addSuppressionFormReducer(initialAddSuppressionFormState, {
      type: 'submitFailed',
      value: 'Network timeout',
    })
    expect(result.submitError).toBe('Network timeout')
  })
})

describe('canSubmitAddSuppression', () => {
  it('returns false when isSaving is true', () => {
    expect(canSubmitAddSuppression({ isSaving: true, scope: 'global', productId: '' })).toBe(false)
  })

  it('returns true for global scope without productId', () => {
    expect(canSubmitAddSuppression({ isSaving: false, scope: 'global', productId: '' })).toBe(true)
  })

  it('returns false for product scope without productId', () => {
    expect(canSubmitAddSuppression({ isSaving: false, scope: 'product', productId: '' })).toBe(
      false,
    )
  })

  it('returns true for product scope with productId', () => {
    expect(
      canSubmitAddSuppression({ isSaving: false, scope: 'product', productId: 'prod_1' }),
    ).toBe(true)
  })
})

describe('buildSuppressionProductOptions', () => {
  it('returns products from the products list', () => {
    const options = buildSuppressionProductOptions([product], [])
    expect(options).toEqual([{ id: 'prod_camaudit', name: 'CAMAudit' }])
  })

  it('handles undefined products gracefully', () => {
    const options = buildSuppressionProductOptions(undefined, [])
    expect(options).toEqual([])
  })

  it('adds product from suppressions when not in products list', () => {
    const options = buildSuppressionProductOptions(undefined, [productSuppression])
    expect(options).toEqual([{ id: 'prod_camaudit', name: 'prod_camaudit' }])
  })

  it('does not duplicate when product is in both products list and suppressions', () => {
    const options = buildSuppressionProductOptions([product], [productSuppression])
    expect(options).toHaveLength(1)
    expect(options[0].id).toBe('prod_camaudit')
    expect(options[0].name).toBe('CAMAudit')
  })

  it('skips suppression entries without product_id', () => {
    const options = buildSuppressionProductOptions([], [globalSuppression])
    expect(options).toEqual([])
  })
})

async function resetSearchParams() {
  const { useSearchParams } = await import('react-router')
  vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()])
}

describe('SuppressionsPage loading state', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    await resetSearchParams()
  })

  it('shows skeleton when both scopes are loading', () => {
    setupQueries({ globalLoading: true, productLoading: true })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('animate-pulse')
    expect(markup).toContain('Block list')
  })
})

describe('SuppressionsPage success states', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    await resetSearchParams()
  })

  it('renders global and product tab counts', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('All products (1)')
    expect(markup).toContain('One product (1)')
  })

  it('renders global suppression email in the markup', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('global@example.com')
  })

  it('renders product suppression email in the markup on global tab (when scope=global)', () => {
    // Put it in the global suppression for the active tab
    const sup: SuppressionRow = { ...productSuppression, scope: 'global', product_id: null }
    setupQueries({ globalData: [globalSuppression, sup], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('product@example.com')
  })

  it('renders Add Suppression button', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('Block an address')
  })

  it('renders suppression source badge with correct variant for bounce', () => {
    const bounceSup: SuppressionRow = { ...globalSuppression, id: 'supp_bounce', source: 'bounce' }
    setupQueries({ globalData: [bounceSup], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('Bounced')
  })

  it('renders complaint source suppression', () => {
    setupQueries({ globalData: [complaintSuppression], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('Marked as spam')
  })

  it('renders webhook source suppression in global tab', () => {
    const globalWebhook: SuppressionRow = {
      ...webhookSuppression,
      scope: 'global',
      product_id: null,
    }
    setupQueries({ globalData: [globalWebhook], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('Email provider')
  })

  it('renders product name badge for product-scoped suppressions in per-product tab', async () => {
    // Switch to product tab
    const { useSearchParams } = await import('react-router')
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('scope=product'), vi.fn()])
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('product@example.com')
  })

  it('renders an em dash for null reason in suppression row', () => {
    // productSuppression has null reason - render in global tab to test
    const sup: SuppressionRow = { ...productSuppression, scope: 'global', product_id: null }
    setupQueries({ globalData: [sup], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('—')
  })

  it('renders reason text when present', () => {
    setupQueries({ globalData: [complaintSuppression], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('spam report')
  })

  it('shows empty state when no suppressions in a scope', () => {
    setupQueries({ globalData: [], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('No blocked addresses yet')
  })

  it('renders product_id as fallback when product not in productMap', async () => {
    // Switch to product tab to see the product-scoped row
    const { useSearchParams } = await import('react-router')
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('scope=product'), vi.fn()])
    const unknownProdSuppression: SuppressionRow = {
      ...productSuppression,
      product_id: 'unknown_prod',
    }
    setupQueries({ globalData: [], productData: [unknownProdSuppression], products: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('unknown_prod')
  })

  it('shows the list cap description', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('Showing up to 100 recent blocks in each tab')
  })

  it('calls useQuery for global, product, and products keys', () => {
    setupQueries()
    renderToStaticMarkup(<SuppressionsPage />)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['suppressions', expect.objectContaining({ scope: 'global' })],
      }),
    )
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['suppressions', expect.objectContaining({ scope: 'product' })],
      }),
    )
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['products'] }))
  })
})

describe('SuppressionsPage error states', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    await resetSearchParams()
  })

  it('shows both-errors state when both scopes fail', () => {
    setupQueries({
      globalError: new Error('global failed'),
      productError: new Error('product failed'),
    })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('We could not load the block list.')
    expect(markup).toContain('global failed')
  })

  it('shows only global error when global scope fails but product succeeds', () => {
    setupQueries({ globalError: new Error('global unavailable') })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('We could not load the all-products list.')
    expect(markup).toContain('global unavailable')
    expect(markup).not.toContain('We could not load the block list.')
  })

  it('shows only product error when product scope fails but global succeeds', () => {
    setupQueries({ productError: new Error('product unavailable') })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('We could not load the one-product list.')
    expect(markup).toContain('product unavailable')
    expect(markup).not.toContain('We could not load the block list.')
  })

  it('keeps global suppressions visible when product scope fails', () => {
    setupQueries({ productError: new Error('product down') })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('All products (1)')
    expect(markup).toContain('global@example.com')
  })

  it('shows global loading skeleton when global still loading but product done', () => {
    setupQueries({ globalLoading: true })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    // When globalLoading=true (but not productLoading), the outer skeleton is NOT shown
    // but the global tab content shows skeleton. The tab is active, so skeleton is rendered.
    expect(markup).toContain('animate-pulse')
    expect(markup).toContain('All products (0)')
  })

  it('shows page structure when only product loading (global done)', () => {
    setupQueries({ productLoading: true, globalData: [globalSuppression] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    // Global tab is active with data, product tab is inactive and loading
    expect(markup).toContain('All products (1)')
    expect(markup).toContain('global@example.com')
    expect(markup).toContain('One product (0)')
  })
})

describe('SuppressionsPage tab navigation via searchParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
  })

  it('defaults to global tab when no scope param', async () => {
    const { useSearchParams } = await import('react-router')
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()])
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('All products (1)')
  })

  it('renders product tab when scope=product in search params', async () => {
    const { useSearchParams } = await import('react-router')
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('scope=product'), vi.fn()])
    setupQueries()
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain('One product (1)')
  })
})

describe('SuppressionsPage suppression source variants', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    // Reset searchParams to global tab
    const { useSearchParams } = await import('react-router')
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()])
  })

  it.each([
    ['manual', 'Added by hand'],
    ['webhook', 'Email provider'],
    ['list_import', 'Imported'],
    ['complaint', 'Marked as spam'],
    ['bounce', 'Bounced'],
    ['suppression', 'Provider list'],
    ['instantly_webhook', 'Cold outreach'],
  ] as const)('renders source badge for %s', (source, label) => {
    const sup: SuppressionRow = {
      ...globalSuppression,
      id: `supp_${source}`,
      source,
    }
    setupQueries({ globalData: [sup], productData: [] })
    const markup = renderToStaticMarkup(<SuppressionsPage />)
    expect(markup).toContain(label)
  })
})
