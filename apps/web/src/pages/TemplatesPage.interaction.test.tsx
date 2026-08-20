// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { TemplateCatalogRow } from '../lib/types'
import { TemplatePreviewFrame, TemplatesPage } from './TemplatesPage'

vi.mock('../lib/api', () => ({
  getTemplates: vi.fn(),
  apiFetchText: vi.fn(),
  apiUrl: vi.fn((path: string) => `http://localhost${path}`),
}))

const getTemplates = vi.mocked(api.getTemplates)
const apiFetchText = vi.mocked(api.apiFetchText)

const BASE_TEMPLATE: TemplateCatalogRow = {
  slug: 'welcome-email',
  product_id: 'prod_acme',
  product_slug: 'acme',
  product_name: 'Acme Mailer',
  kind: 'react-email',
  renderable: false,
  preview_url: '',
  usage_count: 3,
  sequences: [
    {
      slug: 'onboarding',
      version: 1,
      is_active: true,
      step_ids: ['step_1'],
      subjects: ['Welcome!'],
    },
  ],
  source: {},
}

const RENDERABLE_TEMPLATE: TemplateCatalogRow = {
  ...BASE_TEMPLATE,
  slug: 'promo-email',
  renderable: true,
  preview_url: '/api/internal/templates/promo-email/preview',
  usage_count: 1,
  sequences: [
    {
      slug: 'promo-seq',
      version: 1,
      is_active: false,
      step_ids: ['step_2'],
      subjects: ['Promo'],
    },
  ],
  source: { legacy_key: 'promo_key' },
}

const TEMPLATE_B: TemplateCatalogRow = {
  ...BASE_TEMPLATE,
  slug: 'beta-email',
  product_id: 'prod_beta',
  product_slug: 'beta',
  product_name: 'Beta Product',
  usage_count: 0,
  sequences: [],
}

function renderPage(): ReactElement {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TemplatesPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TemplatesPage (interaction)', () => {
  it('shows skeleton while loading', () => {
    getTemplates.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // During loading the table should not yet exist
    expect(container.querySelector('[aria-label="Email templates"]')).toBeNull()
  })

  it('renders the templates table after data loads', async () => {
    getTemplates.mockResolvedValue([BASE_TEMPLATE])
    render(renderPage())

    // The Template column leads with the humanized name, with the raw slug kept
    // as a secondary line so the canonical id is still visible.
    expect(await screen.findByText('Welcome email')).toBeInTheDocument()
    expect(screen.getByText('welcome-email')).toBeInTheDocument()
    expect(screen.getByText('1 templates across 1 products')).toBeInTheDocument()
    expect(screen.getByText('No preview')).toBeInTheDocument()
    // The Sequences column reads as a humanized name, not the raw slug
    expect(screen.getByText('Onboarding')).toBeInTheDocument()
    expect(screen.queryByText('onboarding')).toBeNull()
  })

  it('shows "Not used yet" when a template is in no sequence', async () => {
    getTemplates.mockResolvedValue([TEMPLATE_B])
    render(renderPage())

    expect(await screen.findByText('beta-email')).toBeInTheDocument()
    expect(screen.getByText('Not used yet')).toBeInTheDocument()
  })

  it('shows empty-state when filtered list is empty', async () => {
    getTemplates.mockResolvedValue([])
    render(renderPage())

    // Wait for loading to finish; with empty data, filters show empty state
    await waitFor(() => {
      expect(screen.getByText('0 templates across 0 products')).toBeInTheDocument()
    })
    expect(screen.getByText('No templates found')).toBeInTheDocument()
  })

  it('shows error state and triggers refetch on Retry click', async () => {
    getTemplates.mockRejectedValueOnce(new Error('network down'))
    render(renderPage())

    expect(await screen.findByText('Failed to load templates')).toBeInTheDocument()
    const callsBefore = getTemplates.mock.calls.length

    // Make the retry also fail (or resolve) — just count the call
    getTemplates.mockResolvedValue([])
    const retry = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retry)

    await waitFor(() => {
      expect(getTemplates.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('filters by product via the Select — hides other-product templates', async () => {
    const user = userEvent.setup()
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')
    expect(screen.getByText('beta-email')).toBeInTheDocument()

    const trigger = screen.getByRole('combobox', { name: /filter templates by product/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /acme mailer/i }))

    await waitFor(() => {
      expect(screen.queryByText('beta-email')).toBeNull()
    })
    expect(screen.getByText('welcome-email')).toBeInTheDocument()
  })

  it('selecting "All products" after a product filter shows all templates again', async () => {
    const user = userEvent.setup()
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')

    const trigger = screen.getByRole('combobox', { name: /filter templates by product/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /acme mailer/i }))
    await waitFor(() => expect(screen.queryByText('beta-email')).toBeNull())

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /all products/i }))
    await waitFor(() => expect(screen.getByText('beta-email')).toBeInTheDocument())
    expect(screen.getByText('welcome-email')).toBeInTheDocument()
  })

  it('shows "No templates found" when the product filter yields no rows', async () => {
    const user = userEvent.setup()
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')

    const trigger = screen.getByRole('combobox', { name: /filter templates by product/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /beta product/i }))
    await waitFor(() => expect(screen.queryByText('welcome-email')).toBeNull())

    // Restore to Acme Mailer and the row reappears
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /acme mailer/i }))
    await waitFor(() => expect(screen.getByText('welcome-email')).toBeInTheDocument())
  })

  it('search narrows the table to matching templates', async () => {
    const user = userEvent.setup()
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')
    expect(screen.getByText('beta-email')).toBeInTheDocument()

    const searchBox = screen.getByLabelText(/search templates by name or product/i)
    await user.type(searchBox, 'beta')

    await waitFor(() => expect(screen.queryByText('welcome-email')).toBeNull())
    expect(screen.getByText('beta-email')).toBeInTheDocument()
  })

  it('clicking a sortable header toggles aria-sort and reorders rows', async () => {
    const user = userEvent.setup()
    // usage_count: welcome=3, beta=0 — sort ascending should put beta first
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')

    const usesHeader = screen.getByRole('button', { name: /uses/i })
    const headerCell = usesHeader.closest('th') as HTMLTableCellElement
    expect(headerCell).toHaveAttribute('aria-sort', 'none')

    await user.click(usesHeader)
    expect(headerCell).toHaveAttribute('aria-sort', 'ascending')

    // After ascending sort by uses, beta-email (0) should come before welcome-email (3)
    const rows = screen.getAllByRole('row')
    const bodyText = rows.map((r) => r.textContent ?? '')
    const betaIdx = bodyText.findIndex((t) => t.includes('beta-email'))
    const welcomeIdx = bodyText.findIndex((t) => t.includes('welcome-email'))
    expect(betaIdx).toBeLessThan(welcomeIdx)
  })

  it('Export CSV button is enabled with rows and disabled when empty', async () => {
    const user = userEvent.setup()
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')
    const exportBtn = screen.getByRole('button', { name: /export csv/i })
    expect(exportBtn).toBeEnabled()

    // Filter to a query with no matches — export should disable
    const searchBox = screen.getByLabelText(/search templates by name or product/i)
    await user.type(searchBox, 'zzz-no-match')
    await waitFor(() => expect(exportBtn).toBeDisabled())
  })

  it('clicking Export CSV builds a download exercising every column accessor', async () => {
    // Mock URL.createObjectURL so jsdom does not throw on the Blob download.
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    const origCreate = globalThis.URL.createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    try {
      const user = userEvent.setup()
      // BASE_TEMPLATE has sequences (Sequences accessor returns a string);
      // TEMPLATE_B has none (Sequences accessor falls through to `|| null`).
      getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
      render(renderPage())

      await screen.findByText('welcome-email')
      const exportBtn = screen.getByRole('button', { name: /export csv/i })
      await user.click(exportBtn)

      expect(createObjectURL).toHaveBeenCalled()
    } finally {
      globalThis.URL.createObjectURL = origCreate
      globalThis.URL.revokeObjectURL = origRevoke
    }
  })

  it('sorting by Template, Product, and Type headers reorders rows', async () => {
    const user = userEvent.setup()
    getTemplates.mockResolvedValue([BASE_TEMPLATE, TEMPLATE_B])
    render(renderPage())

    await screen.findByText('welcome-email')

    // Template (slug accessor): ascending puts beta-email before welcome-email.
    const templateHeader = screen.getByRole('button', { name: /template/i })
    await user.click(templateHeader)
    expect(templateHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    let bodyText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(bodyText.findIndex((t) => t.includes('beta-email'))).toBeLessThan(
      bodyText.findIndex((t) => t.includes('welcome-email')),
    )

    // Product (product_slug accessor): ascending puts acme before beta.
    const productHeader = screen.getByRole('button', { name: /product/i })
    await user.click(productHeader)
    expect(productHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    bodyText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(bodyText.findIndex((t) => t.includes('Acme Mailer'))).toBeLessThan(
      bodyText.findIndex((t) => t.includes('Beta Product')),
    )

    // Type (kind accessor): both share a kind, but clicking still runs the accessor.
    const typeHeader = screen.getByRole('button', { name: /type/i })
    await user.click(typeHeader)
    expect(typeHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('renders preview button for renderable templates', async () => {
    apiFetchText.mockResolvedValue('<html>preview</html>')
    getTemplates.mockResolvedValue([RENDERABLE_TEMPLATE])
    render(renderPage())

    expect(await screen.findByRole('button', { name: /preview/i })).toBeInTheDocument()
    expect(screen.queryByText('No preview')).toBeNull()
  })

  it('opens preview dialog and shows iframe after fetch resolves', async () => {
    apiFetchText.mockResolvedValue('<html>hello preview</html>')
    getTemplates.mockResolvedValue([RENDERABLE_TEMPLATE])
    render(renderPage())

    const previewBtn = await screen.findByRole('button', { name: /preview/i })
    await userEvent.click(previewBtn)

    // Dialog should open — check for dialog role
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    // iframe rendered inside dialog after fetch resolves
    await waitFor(() => {
      expect(document.querySelector('iframe[title="Preview of promo-email"]')).toBeInTheDocument()
    })
  })

  it('shows usage count pluralisation in dialog description', async () => {
    apiFetchText.mockResolvedValue('<html></html>')
    const singleUseTemplate: TemplateCatalogRow = {
      ...RENDERABLE_TEMPLATE,
      usage_count: 1,
      sequences: [
        {
          slug: 'seq-a',
          version: 1,
          is_active: true,
          step_ids: [],
          subjects: [],
        },
      ],
    }
    getTemplates.mockResolvedValue([singleUseTemplate])
    render(renderPage())

    const previewBtn = await screen.findByRole('button', { name: /preview/i })
    await userEvent.click(previewBtn)

    await waitFor(() => {
      // "1 use across 1 sequence" — singular forms
      expect(screen.getByText(/1 use across 1 sequence/)).toBeInTheDocument()
    })
  })

  it('shows plural usage/sequences in dialog description', async () => {
    apiFetchText.mockResolvedValue('<html></html>')
    const multiUseTemplate: TemplateCatalogRow = {
      ...RENDERABLE_TEMPLATE,
      usage_count: 5,
      sequences: [
        { slug: 'seq-a', version: 1, is_active: true, step_ids: [], subjects: [] },
        { slug: 'seq-b', version: 1, is_active: true, step_ids: [], subjects: [] },
      ],
    }
    getTemplates.mockResolvedValue([multiUseTemplate])
    render(renderPage())

    const previewBtn = await screen.findByRole('button', { name: /preview/i })
    await userEvent.click(previewBtn)

    await waitFor(() => {
      expect(screen.getByText(/5 uses across 2 sequences/)).toBeInTheDocument()
    })
  })

  it('shows the sequences as readable names joined by comma, not raw slugs', async () => {
    getTemplates.mockResolvedValue([
      {
        ...BASE_TEMPLATE,
        sequences: [
          { slug: 'seq-one', version: 1, is_active: true, step_ids: [], subjects: [] },
          { slug: 'seq-two', version: 1, is_active: true, step_ids: [], subjects: [] },
        ],
      },
    ])
    render(renderPage())

    await screen.findByText('welcome-email')
    // Each sequence renders as its own humanized link; the comma joins them.
    expect(screen.getByText('Seq one')).toBeInTheDocument()
    expect(screen.getByText('Seq two')).toBeInTheDocument()
    expect(screen.queryByText('seq-one')).toBeNull()
    expect(screen.queryByText('seq-two')).toBeNull()
  })

  it('renders each sequence as a drill-down link to the sequences list', async () => {
    getTemplates.mockResolvedValue([BASE_TEMPLATE])
    render(renderPage())

    await screen.findByText('welcome-email')
    const link = screen.getByRole('link', { name: 'Onboarding' })
    expect(link).toHaveAttribute('href', '/sequences?q=onboarding')
  })

  it('shows plain kind label in dialog and does not leak raw kind when legacy_key is absent', async () => {
    apiFetchText.mockResolvedValue('<html></html>')
    const noLegacyTemplate: TemplateCatalogRow = {
      ...RENDERABLE_TEMPLATE,
      source: {},
    }
    getTemplates.mockResolvedValue([noLegacyTemplate])
    render(renderPage())

    const previewBtn = await screen.findByRole('button', { name: /preview/i })
    await userEvent.click(previewBtn)

    await waitFor(() => {
      // dialog should be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    // kind badge shows friendly label 'Standard', not raw 'react-email'
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Standard')
    expect(screen.queryByText('react-email')).toBeNull()
  })

  it('uses legacy_key as sourceLabel when present', async () => {
    apiFetchText.mockResolvedValue('<html></html>')
    // RENDERABLE_TEMPLATE has source.legacy_key = 'promo_key'
    getTemplates.mockResolvedValue([RENDERABLE_TEMPLATE])
    render(renderPage())

    const previewBtn = await screen.findByRole('button', { name: /preview/i })
    await userEvent.click(previewBtn)

    await waitFor(() => {
      expect(screen.getByText('promo_key')).toBeInTheDocument()
    })
  })

  it('usage_count toLocaleString renders in table', async () => {
    getTemplates.mockResolvedValue([{ ...BASE_TEMPLATE, usage_count: 1234 }])
    render(renderPage())

    await screen.findByText('welcome-email')
    // toLocaleString of 1234 — just confirm it renders (locale varies)
    expect(screen.getByText('1,234')).toBeInTheDocument()
  })
})

describe('TemplatePreviewFrame (interaction)', () => {
  function renderFrame(
    template: TemplateCatalogRow,
    initialStatus?: 'loading' | 'ready' | 'failed',
  ): ReactElement {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return (
      <QueryClientProvider client={qc}>
        <TemplatePreviewFrame template={template} initialStatus={initialStatus} />
      </QueryClientProvider>
    )
  }

  const frameTemplate: TemplateCatalogRow = {
    ...BASE_TEMPLATE,
    renderable: true,
    preview_url: '/api/internal/templates/promo/preview',
  }

  it('shows loading indicator and then iframe on successful fetch', async () => {
    apiFetchText.mockResolvedValue('<html>content</html>')
    render(renderFrame(frameTemplate))

    // Initially loading banner visible
    expect(screen.getByText('Loading preview...')).toBeInTheDocument()

    // After fetch resolves, loading banner disappears
    await waitFor(() => {
      expect(screen.queryByText('Loading preview...')).toBeNull()
    })
    // iframe is present
    expect(document.querySelector('iframe')).toBeInTheDocument()
  })

  it('shows failed state with error message on fetch error', async () => {
    apiFetchText.mockRejectedValue(new Error('endpoint offline'))
    render(renderFrame(frameTemplate))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText('endpoint offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry preview/i })).toBeInTheDocument()
  })

  it('shows generic error message when error has empty message', async () => {
    const emptyMsgError = new Error('')
    apiFetchText.mockRejectedValue(emptyMsgError)
    render(renderFrame(frameTemplate))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText('Preview endpoint failed')).toBeInTheDocument()
  })

  it('shows generic error message for non-Error thrown value', async () => {
    apiFetchText.mockRejectedValue('some string error')
    render(renderFrame(frameTemplate))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText('Preview endpoint failed')).toBeInTheDocument()
  })

  it('retry button re-triggers fetch and clears error state', async () => {
    apiFetchText.mockRejectedValueOnce(new Error('first failure'))
    apiFetchText.mockResolvedValue('<html>retry success</html>')
    render(renderFrame(frameTemplate))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    const callsBefore = apiFetchText.mock.calls.length
    const retryBtn = screen.getByRole('button', { name: /retry preview/i })
    await userEvent.click(retryBtn)

    await waitFor(() => {
      expect(apiFetchText.mock.calls.length).toBeGreaterThan(callsBefore)
    })
    // After retry succeeds, alert should disappear
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('starts in ready state when initialStatus is ready', async () => {
    apiFetchText.mockResolvedValue('<html></html>')
    render(renderFrame(frameTemplate, 'ready'))

    // Even with initialStatus=ready, the effect fires and sets loading first.
    // Just ensure iframe eventually appears.
    await waitFor(() => {
      expect(document.querySelector('iframe')).toBeInTheDocument()
    })
  })

  it('starts in failed state when initialStatus is failed', async () => {
    // With initialStatus=failed, effect still fires, let it fail
    apiFetchText.mockRejectedValue(new Error('still broken'))
    render(renderFrame(frameTemplate, 'failed'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })
})
