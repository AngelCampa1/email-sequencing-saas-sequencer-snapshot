import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateCatalogRow } from '../lib/types'
import { TemplatePreviewFrame, TemplatesPage } from './TemplatesPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

const mockUseQuery = vi.mocked(useQuery)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return value as unknown as ReturnType<typeof useQuery>
}

const baseTemplate: TemplateCatalogRow = {
  slug: 'missing/template',
  product_id: 'prod_camaudit',
  product_slug: 'camaudit',
  product_name: 'CAMAudit',
  kind: 'react-email',
  renderable: false,
  preview_url: '',
  usage_count: 1,
  sequences: [
    {
      slug: 'broken-demo',
      version: 1,
      is_active: true,
      step_ids: ['missing'],
      subjects: ['Missing template'],
    },
  ],
  source: {},
}

describe('TemplatesPage preview actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not expose a preview action for non-renderable templates', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: [baseTemplate],
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('No preview')
    expect(markup).not.toContain('Preview</button>')
    expect(markup).not.toContain('<iframe')
  })

  it('does not expose a preview action when the preview URL is blank', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: [
          {
            ...baseTemplate,
            renderable: true,
            preview_url: '   ',
          },
        ],
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('No preview')
    expect(markup).not.toContain('Preview</button>')
    expect(markup).not.toContain('<iframe')
  })

  it('renders recoverable query errors with a retry action', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: undefined,
        isLoading: false,
        error: new Error('Template catalog timed out'),
        refetch: vi.fn(),
        isFetching: false,
      }),
    )

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Failed to load templates')
    expect(markup).toContain('Template catalog timed out')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('Failed to load templates:')
  })

  it('exposes the search and product-filter controls to assistive technology', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: [
          baseTemplate,
          {
            ...baseTemplate,
            product_id: 'prod_floriva_web',
            product_slug: 'floriva-web',
            product_name: 'Floriva',
            slug: 'floriva-web/welcome',
          },
        ],
        isLoading: false,
        error: null,
      }),
    )

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>,
    )

    // The toolbar exposes an accessible search box and a labelled product filter.
    expect(markup).toContain('aria-label="Search templates by name or product"')
    expect(markup).toContain('aria-label="Filter templates by product"')
    // An Export CSV action is present.
    expect(markup).toContain('Export CSV')
  })

  it('renders a loading state while a preview iframe is loading', () => {
    const markup = renderToStaticMarkup(
      <TemplatePreviewFrame
        template={{
          ...baseTemplate,
          renderable: true,
          preview_url: '/api/internal/templates/missing%2Ftemplate/preview',
        }}
      />,
    )

    expect(markup).toContain('Loading preview...')
    expect(markup).toContain('<iframe')
    expect(markup).toContain('Preview of missing/template')
  })

  it('renders a retryable error state when a preview iframe fails', () => {
    const markup = renderToStaticMarkup(
      <TemplatePreviewFrame
        template={{
          ...baseTemplate,
          renderable: true,
          preview_url: '/api/internal/templates/missing%2Ftemplate/preview',
        }}
        initialStatus="failed"
      />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Preview failed to load.')
    expect(markup).toContain('Retry preview')
    expect(markup).toContain('Open endpoint')
    expect(markup).not.toContain('<iframe')
  })
})
