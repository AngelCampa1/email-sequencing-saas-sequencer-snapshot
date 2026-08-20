import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductRow, SuppressionRow } from '../lib/types'
import { buildSuppressionProductOptions, SuppressionsPage } from './SuppressionsPage'

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockUseMutation = vi.mocked(useMutation)

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
  }
})

const mockUseQuery = vi.mocked(useQuery)
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
  id: 'supp_global',
  email: 'global@example.com',
  scope: 'global',
  product_id: null,
  reason: 'manual',
  source: 'manual',
  created_at: '2026-05-20T10:00:00.000Z',
}

const productSuppression: SuppressionRow = {
  id: 'supp_product',
  email: 'product@example.com',
  scope: 'product',
  product_id: product.id,
  reason: 'manual',
  source: 'manual',
  created_at: '2026-05-20T09:00:00.000Z',
}

describe('SuppressionsPage scoped lists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: unknown[] }).queryKey
      const scope = suppressionScopeFromKey(key)
      if (key[0] === 'products') {
        return queryResult({ data: [product], isLoading: false, error: null })
      }
      if (scope === 'global') {
        return queryResult({ data: [globalSuppression], isLoading: false, error: null })
      }
      if (scope === 'product') {
        return queryResult({ data: [productSuppression], isLoading: false, error: null })
      }
      return queryResult({ data: undefined, isLoading: false, error: null })
    })
  })

  it('renders global and product tabs from separately fetched scoped suppression lists', () => {
    const markup = renderToStaticMarkup(<SuppressionsPage />)

    expect(markup).toContain('All products (1)')
    expect(markup).toContain('One product (1)')
    expect(markup).toContain('global@example.com')
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
  })

  it('keeps suppression lists visible when product labels fail to load', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: unknown[] }).queryKey
      const scope = suppressionScopeFromKey(key)
      if (key[0] === 'products') {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: new Error('products unavailable'),
        })
      }
      if (scope === 'global') {
        return queryResult({ data: [globalSuppression], isLoading: false, error: null })
      }
      if (scope === 'product') {
        return queryResult({ data: [productSuppression], isLoading: false, error: null })
      }
      return queryResult({ data: undefined, isLoading: false, error: null })
    })

    const markup = renderToStaticMarkup(<SuppressionsPage />)

    expect(markup).toContain('All products (1)')
    expect(markup).toContain('One product (1)')
    expect(markup).toContain('global@example.com')
    expect(markup).toContain('Block an address')
    expect(markup).not.toContain('Failed to load products')
  })

  it('builds product-specific add suppression options from loaded product suppressions when products fail', () => {
    const options = buildSuppressionProductOptions(undefined, [productSuppression])

    expect(options).toEqual([{ id: 'prod_camaudit', name: 'prod_camaudit' }])
  })

  it('keeps global suppressions visible when the product-scoped list fails to load', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: unknown[] }).queryKey
      const scope = suppressionScopeFromKey(key)
      if (key[0] === 'products') {
        return queryResult({ data: [product], isLoading: false, error: null })
      }
      if (scope === 'global') {
        return queryResult({ data: [globalSuppression], isLoading: false, error: null })
      }
      if (scope === 'product') {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: new Error('product suppressions unavailable'),
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({ data: undefined, isLoading: false, error: null })
    })

    const markup = renderToStaticMarkup(<SuppressionsPage />)

    expect(markup).toContain('All products (1)')
    expect(markup).toContain('One product (0)')
    expect(markup).toContain('global@example.com')
    expect(markup).toContain('We could not load the one-product list.')
    expect(markup).toContain('product suppressions unavailable')
    expect(markup).not.toContain('We could not load the block list.')
  })
})
