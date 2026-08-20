import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SequencesPage } from './SequencesPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn(), error: null })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('../components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

describe('SequencesPage product labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sequences with product ids when product labels fail to load', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'sequences') {
        return queryResult({
          data: [
            {
              slug: 'camaudit-welcome',
              product_id: 'prod_camaudit',
              version: 3,
              is_active: true,
              goal: 'activation',
              compiled_at: '2026-01-01T00:00:00.000Z',
              compiled_from_sha: 'abc123',
              definition: { steps: [{ id: 'send', delay: '0m', template: 'welcome' }] },
            },
          ],
        })
      }
      if (key === 'products') {
        return queryResult({ error: new Error('products unavailable') })
      }
      return queryResult({ data: undefined })
    })

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SequencesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('camaudit-welcome')
    expect(markup).toContain('prod_camaudit')
    expect(markup).not.toContain('Failed to load product labels')
  })

  it('shows the humanized sequence name as the primary label with the slug beneath', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'sequences') {
        return queryResult({
          data: [
            {
              slug: 'camaudit-welcome',
              product_id: 'prod_camaudit',
              version: 3,
              is_active: true,
              goal: 'activation',
              compiled_at: '2026-01-01T00:00:00.000Z',
              compiled_from_sha: 'abc123',
              definition: { steps: [{ id: 'send', delay: '0m', template: 'welcome' }] },
            },
          ],
        })
      }
      if (key === 'products') {
        return queryResult({
          data: [{ id: 'prod_camaudit', name: 'CAMAudit', slug: 'camaudit' }],
        })
      }
      return queryResult({ data: undefined })
    })

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SequencesPage />
      </MemoryRouter>,
    )

    // The product prefix is stripped for the readable label, but the raw slug
    // stays visible as the secondary reference operators look sequences up by.
    expect(markup).toContain('>Welcome<')
    expect(markup).toContain('camaudit-welcome')
  })

  it('keeps product filter options available from sequence product ids when product labels fail to load', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'sequences') {
        return queryResult({
          data: [
            {
              slug: 'camaudit-welcome',
              product_id: 'prod_camaudit',
              version: 3,
              is_active: true,
              goal: 'activation',
              compiled_at: '2026-01-01T00:00:00.000Z',
              compiled_from_sha: 'abc123',
              definition: { steps: [{ id: 'send', delay: '0m', template: 'welcome' }] },
            },
            {
              slug: 'floriva-web-welcome',
              product_id: 'prod_floriva_web',
              version: 1,
              is_active: false,
              goal: 'activation',
              compiled_at: '2026-01-01T00:00:00.000Z',
              compiled_from_sha: 'def456',
              definition: { steps: [{ id: 'send', delay: '0m', template: 'welcome' }] },
            },
          ],
        })
      }
      if (key === 'products') {
        return queryResult({ error: new Error('products unavailable') })
      }
      return queryResult({ data: undefined })
    })

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SequencesPage />
      </MemoryRouter>,
    )

    expect(markup.match(/prod_camaudit/g)).toHaveLength(2)
    expect(markup.match(/prod_floriva_web/g)).toHaveLength(2)
  })
})
