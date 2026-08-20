import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsPage } from './ContactsPage'
import { SequencesPage } from './SequencesPage'

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

describe('filter accessibility labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'contacts') {
        return queryResult({ data: [] })
      }
      if (key === 'sequences') {
        return queryResult({ data: [] })
      }
      if (key === 'products') {
        return queryResult({ data: [] })
      }
      return queryResult({ data: undefined })
    })
  })

  it('labels the contacts search input independently of its placeholder', () => {
    const markup = renderToStaticMarkup(<ContactsPage />)

    expect(markup).toContain('aria-label="Search contacts by name or email"')
  })

  it('labels sequence filter controls independently of placeholders', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SequencesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('aria-label="Search sequences"')
    expect(markup).toContain('aria-label="Filter sequences by product"')
    expect(markup).toContain('aria-label="Filter sequences by status"')
  })
})
