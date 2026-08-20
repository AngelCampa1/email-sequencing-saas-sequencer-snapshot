import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductsPage } from './ProductsPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn(), error: null })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

const mockUseQuery = vi.mocked(useQuery)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return {
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useQuery>
}

describe('ProductsPage empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'products') {
        return queryResult({ data: [] })
      }
      if (key === 'sequences') {
        return queryResult({ data: [] })
      }
      if (key === 'lead-magnets') {
        return queryResult({ data: [] })
      }
      return queryResult({ data: undefined })
    })
  })

  it('shows a plain empty state instead of a migration or CLI note', () => {
    const markup = renderToStaticMarkup(<ProductsPage />)

    expect(markup).toContain('No products yet')
    expect(markup).toContain('Products show up here once they are added.')
    expect(markup).not.toContain('CLI seed script')
    expect(markup).not.toContain('packages/db/migrations')
  })

  it('renders products when auxiliary count queries fail', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'products') {
        return queryResult({
          data: [
            {
              id: 'prod_camaudit',
              slug: 'camaudit',
              name: 'CAMAudit',
              brand_color: '#0f766e',
              default_from_email: 'founder@camaudit.io',
              default_reply_to: null,
              resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT',
              suppression_scope: 'product',
              firewall_partner_id: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        })
      }
      if (key === 'sequences') {
        return queryResult({ error: new Error('sequence count failed') })
      }
      if (key === 'lead-magnets') {
        return queryResult({ error: new Error('lead magnet count failed') })
      }
      return queryResult({ data: undefined })
    })

    const markup = renderToStaticMarkup(<ProductsPage />)

    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('founder@camaudit.io')
    expect(markup).toContain('Unavailable')
    // Product-scoped suppression reads in plain words, not "Product suppression".
    expect(markup).toContain('Blocks this product only')
    expect(markup).not.toContain('Product suppression')
    expect(markup).not.toContain('Failed to load sequence counts')
    expect(markup).not.toContain('Failed to load lead magnet counts')
    expect(markup).not.toContain('>0</p><p class="text-xs text-slate-500">Active sequences')
    expect(markup).not.toContain('>0</p><p class="text-xs text-slate-500">Lead magnets')
  })
})
