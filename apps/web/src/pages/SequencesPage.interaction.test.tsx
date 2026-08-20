// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { ProductRow, SequenceRow } from '../lib/types'
import { SequencesPage } from './SequencesPage'

vi.mock('../lib/api', () => ({
  createSequence: vi.fn(),
  deleteSequence: vi.fn(),
  getProducts: vi.fn(),
  getSequences: vi.fn(),
  getLeadMagnets: vi.fn(),
  updateSequence: vi.fn(),
}))

const createSequence = vi.mocked(api.createSequence)
const deleteSequence = vi.mocked(api.deleteSequence)
const getProducts = vi.mocked(api.getProducts)
const getSequences = vi.mocked(api.getSequences)
const updateSequence = vi.mocked(api.updateSequence)

const PRODUCT_A: ProductRow = {
  id: 'prod_1',
  slug: 'acme',
  name: 'Acme Mailer',
  brand_color: '#ff0000',
  default_from_email: 'hi@acme.test',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_ACME',
  suppression_scope: 'global',
  firewall_partner_id: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const PRODUCT_B: ProductRow = {
  id: 'prod_2',
  slug: 'beta',
  name: 'Beta Product',
  brand_color: '#0000ff',
  default_from_email: 'hi@beta.test',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_BETA',
  suppression_scope: 'product',
  firewall_partner_id: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const SEQ_ACTIVE: SequenceRow = {
  slug: 'welcome-active',
  product_id: 'prod_1',
  version: 1,
  is_active: true,
  goal: 'onboarding',
  compiled_at: '2025-06-01T00:00:00Z',
  definition: {
    steps: [{ delay: '1d', template: 'welcome-email', skip_if: { reply_received: true } }],
  },
}

const SEQ_INACTIVE: SequenceRow = {
  slug: 'old-promo',
  product_id: 'prod_2',
  version: 2,
  is_active: false,
  goal: null,
  compiled_at: '2025-03-01T00:00:00Z',
  definition: { steps: [] },
}

// Sequence whose product_id is not in the products list — exercises the
// "add orphaned product to filter options" branch (lines 119-122).
const SEQ_ORPHAN: SequenceRow = {
  slug: 'orphan-seq',
  product_id: 'prod_orphan',
  version: 1,
  is_active: true,
  goal: null,
  compiled_at: '2025-04-01T00:00:00Z',
  definition: null,
}

function renderPage(initialEntry = '/sequences'): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <SequencesPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  createSequence.mockResolvedValue(SEQ_ACTIVE)
  deleteSequence.mockResolvedValue({ ok: true })
  updateSequence.mockResolvedValue(SEQ_ACTIVE)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SequencesPage (interaction)', () => {
  it('shows a skeleton while sequences are loading', () => {
    getSequences.mockReturnValue(new Promise(() => {}))
    getProducts.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // TableSkeleton renders animated placeholder rows while loading (lines 183-186).
    expect(container.querySelector('[aria-label="Email sequences"]')).toBeNull()
  })

  it('renders active and inactive sequences with correct badges', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    expect(await screen.findByText('welcome-active')).toBeInTheDocument()
    expect(screen.getByText('old-promo')).toBeInTheDocument()
    // is_active true → "Active" badge; false → "Inactive" badge (lines 242-244).
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    // Product name resolved from productMap.
    expect(screen.getByText('Acme Mailer')).toBeInTheDocument()
    expect(screen.getByText('Beta Product')).toBeInTheDocument()
  })

  it('uses product_id as label when product is not in productMap', async () => {
    getSequences.mockResolvedValue([SEQ_ORPHAN])
    getProducts.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('orphan-seq')).toBeInTheDocument()
    // product?.name is undefined → falls back to seq.product_id (line 237).
    expect(screen.getByText('prod_orphan')).toBeInTheDocument()
  })

  it('shows empty-state message when no sequences match', async () => {
    getSequences.mockResolvedValue([])
    getProducts.mockResolvedValue([])
    render(renderPage())

    // filtered.length === 0 branch with no active filters.
    expect(await screen.findByText('No sequences found')).toBeInTheDocument()
    expect(screen.getByText('Compiled sequences will show up here.')).toBeInTheDocument()
  })

  it('shows error state and re-fetches when Retry is clicked', async () => {
    getSequences.mockRejectedValue(new Error('network failure'))
    getProducts.mockResolvedValue([])
    render(renderPage())

    // Error branch renders QueryError (lines 187-195).
    expect(await screen.findByText('Failed to load sequences')).toBeInTheDocument()
    const callsBefore = getSequences.mock.calls.length

    const retry = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retry)

    await waitFor(() => {
      expect(getSequences.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('filters by search input — only matching slugs remain visible', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    await screen.findByText('welcome-active')

    const searchBox = screen.getByRole('textbox', { name: /search sequences/i })
    await userEvent.type(searchBox, 'old')

    // "old-promo" matches; "welcome-active" does not (line 126 matchSearch branch).
    await waitFor(() => {
      expect(screen.queryByText('welcome-active')).toBeNull()
    })
    expect(screen.getByText('old-promo')).toBeInTheDocument()
  })

  it('pre-fills search and pre-filters the list from the ?q= URL parameter', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage('/sequences?q=welcome'))

    // The matching sequence is visible on first paint; the non-match is filtered out.
    expect(await screen.findByText('welcome-active')).toBeInTheDocument()
    expect(screen.queryByText('old-promo')).toBeNull()

    // The search box is seeded with the query string value.
    const searchBox = screen.getByRole('textbox', { name: /search sequences/i })
    expect(searchBox).toHaveValue('welcome')
  })

  it('shows the filtered empty state when search matches nothing', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')

    const searchBox = screen.getByRole('textbox', { name: /search sequences/i })
    await userEvent.type(searchBox, 'zzz-no-match')

    await waitFor(() => {
      expect(screen.getByText('No sequences found')).toBeInTheDocument()
    })
    // An active search shows the "try a different filter" hint, not the empty-repo one.
    expect(screen.getByText('Try a different search or product filter.')).toBeInTheDocument()
  })

  it('displays compiled_at date when present and dash when absent', async () => {
    const seqNoDate: SequenceRow = {
      ...SEQ_ACTIVE,
      slug: 'no-date-seq',
      compiled_at: '',
    }
    getSequences.mockResolvedValue([SEQ_ACTIVE, seqNoDate])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    // compiled_at present → formatDate rendered; absent → em dash via formatDate.
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  it('renders step count from definition.steps array', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    // SEQ_ACTIVE has 1 step — stepCount = def?.steps?.length ?? 0.
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows step count 0 when definition is null', async () => {
    getSequences.mockResolvedValue([SEQ_ORPHAN])
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('orphan-seq')
    // definition is null → stepCount = 0 (line 226, ?? branch).
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('opens SequenceDetailDialog when slug button is clicked', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    const slugBtn = await screen.findByRole('button', { name: /view welcome-active/i })
    await userEvent.click(slugBtn)

    // Dialog opens showing description content.
    await waitFor(() => {
      expect(screen.getByText(/onboarding/i)).toBeInTheDocument()
    })
  })

  it('edits sequence goal, active state, and definition JSON', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    updateSequence.mockResolvedValue({
      ...SEQ_ACTIVE,
      goal: 'activation',
      is_active: false,
      definition: { steps: [] },
    })
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /edit welcome-active/i }))

    const goal = await screen.findByLabelText('Goal')
    await user.clear(goal)
    await user.type(goal, 'activation')

    await user.click(screen.getByRole('checkbox', { name: 'Active' }))

    const definition = screen.getByLabelText('Definition JSON')
    fireEvent.change(definition, { target: { value: '{"steps":[]}' } })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(updateSequence).toHaveBeenCalledWith('welcome-active', {
        goal: 'activation',
        is_active: false,
        definition: { steps: [] },
      })
    })
  })

  it('creates a sequence from the toolbar dialog', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    createSequence.mockResolvedValue({
      ...SEQ_ACTIVE,
      slug: 'new-flow',
      goal: 'activation',
      definition: { steps: [] },
    })
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))

    await user.type(await screen.findByLabelText('Slug'), 'new-flow')
    const productSelect = screen.getByRole('combobox', { name: 'Product' })
    await user.click(productSelect)
    await user.click(await screen.findByRole('option', { name: 'Acme Mailer' }))
    await user.type(screen.getByLabelText('Goal'), 'activation')
    fireEvent.change(screen.getByLabelText('Definition JSON'), {
      target: { value: '{"steps":[]}' },
    })

    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    await waitFor(() => {
      expect(createSequence).toHaveBeenCalledWith({
        slug: 'new-flow',
        product_id: 'prod_1',
        goal: 'activation',
        is_active: true,
        definition: { steps: [] },
      })
    })
  })

  it('deletes a sequence after confirmation', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /delete welcome-active/i }))
    await user.click(await screen.findByRole('button', { name: 'Delete sequence' }))

    await waitFor(() => {
      expect(deleteSequence).toHaveBeenCalledWith('welcome-active')
    })
  })

  it('shows an inline error and does not save invalid definition JSON', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /edit welcome-active/i }))

    const definition = await screen.findByLabelText('Definition JSON')
    fireEvent.change(definition, { target: { value: '{bad json' } })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Definition JSON is not valid.')).toBeInTheDocument()
    expect(updateSequence).not.toHaveBeenCalled()
  })

  it('adds orphaned product_id to filter options list', async () => {
    // SEQ_ORPHAN has product_id not in products list — exercises lines 119-122.
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_ORPHAN])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await screen.findByText('orphan-seq')
    // Both sequences visible — orphaned product_id added to filter without error.
    expect(screen.getByText('prod_orphan')).toBeInTheDocument()
  })

  it('status filter active branch — hides inactive sequences', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    await screen.findByText('welcome-active')
    expect(screen.getByText('old-promo')).toBeInTheDocument()

    // Open Radix Select by clicking its trigger.
    const statusTrigger = screen.getByRole('combobox', { name: /filter sequences by status/i })
    await user.click(statusTrigger)

    // Wait for the portal to render the listbox with options.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Active' })).toBeInTheDocument()
    })

    // Click the "Active" option in the dropdown.
    await user.click(screen.getByRole('option', { name: 'Active' }))

    // After selecting "Active" status, inactive sequence disappears (line 130 branch).
    await waitFor(() => {
      expect(screen.queryByText('old-promo')).toBeNull()
    })
    expect(screen.getByText('welcome-active')).toBeInTheDocument()
  })

  it('status filter inactive branch — hides active sequences', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    await screen.findByText('welcome-active')

    const statusTrigger = screen.getByRole('combobox', { name: /filter sequences by status/i })
    await user.click(statusTrigger)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Inactive' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('option', { name: 'Inactive' }))

    // After selecting "Inactive", active sequence disappears (line 131 branch).
    await waitFor(() => {
      expect(screen.queryByText('welcome-active')).toBeNull()
    })
    expect(screen.getByText('old-promo')).toBeInTheDocument()
  })

  it('product filter — hides sequences from other products', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    await screen.findByText('welcome-active')
    expect(screen.getByText('old-promo')).toBeInTheDocument()

    // Open product filter select (line 127 matchProduct branch).
    const productTrigger = screen.getByRole('combobox', { name: /filter sequences by product/i })
    await user.click(productTrigger)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Acme Mailer' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('option', { name: 'Acme Mailer' }))

    // Only sequences with product_id=prod_1 remain visible.
    await waitFor(() => {
      expect(screen.queryByText('old-promo')).toBeNull()
    })
    expect(screen.getByText('welcome-active')).toBeInTheDocument()
  })

  it('dialog shows no goal section when goal is null', async () => {
    const user = userEvent.setup()
    const seqNoGoal: SequenceRow = {
      ...SEQ_INACTIVE,
      slug: 'no-goal-seq',
      goal: null,
    }
    getSequences.mockResolvedValue([seqNoGoal])
    getProducts.mockResolvedValue([PRODUCT_B])
    render(renderPage())

    const slugBtn = await screen.findByRole('button', { name: /view no-goal-seq/i })
    await user.click(slugBtn)

    // Dialog opens; goal section is conditionally rendered only when seq.goal is truthy (line 75).
    await waitFor(() => {
      expect(screen.getByText(/Raw definition \(advanced\)/i)).toBeInTheDocument()
    })
    expect(screen.queryByText('Goal')).toBeNull()
  })

  it('StepTable shows "No steps defined." when steps array is empty', async () => {
    const user = userEvent.setup()
    // SEQ_INACTIVE has definition: { steps: [] } — exercises StepTable lines 25-26.
    getSequences.mockResolvedValue([SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_B])
    render(renderPage())

    const slugBtn = await screen.findByRole('button', { name: /view old-promo/i })
    await user.click(slugBtn)

    await waitFor(() => {
      expect(screen.getByText('No steps defined.')).toBeInTheDocument()
    })
  })

  it('StepTable shows "No steps defined." when definition has no steps property', async () => {
    const user = userEvent.setup()
    // definition is an object but has no steps key — exercises def?.steps ?? [] = [] branch at line 25.
    const seqNoStepsProp: SequenceRow = {
      slug: 'no-steps-prop',
      product_id: 'prod_1',
      version: 1,
      is_active: true,
      compiled_at: '2025-01-01T00:00:00Z',
      definition: {},
    }
    getSequences.mockResolvedValue([seqNoStepsProp])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    const slugBtn = await screen.findByRole('button', { name: /view no-steps-prop/i })
    await user.click(slugBtn)

    await waitFor(() => {
      expect(screen.getByText('No steps defined.')).toBeInTheDocument()
    })
  })

  it('search also matches by product name', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    await screen.findByText('welcome-active')

    const searchBox = screen.getByRole('textbox', { name: /search sequences/i })
    // "Beta Product" is PRODUCT_B's name, owned by SEQ_INACTIVE only.
    await userEvent.type(searchBox, 'beta product')

    await waitFor(() => {
      expect(screen.queryByText('welcome-active')).toBeNull()
    })
    expect(screen.getByText('old-promo')).toBeInTheDocument()
  })

  it('clicking a sortable header sets aria-sort and reorders rows', async () => {
    const user = userEvent.setup()
    // Two active sequences for PRODUCT_A so the only difference is the slug order.
    const seqB: SequenceRow = { ...SEQ_ACTIVE, slug: 'a-first', version: 3 }
    const seqA: SequenceRow = { ...SEQ_ACTIVE, slug: 'z-last', version: 1 }
    getSequences.mockResolvedValue([seqA, seqB])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('a-first')

    const header = screen.getByRole('button', { name: 'Sequence' })
    const headerCell = header.closest('th') as HTMLTableCellElement
    expect(headerCell).toHaveAttribute('aria-sort', 'none')

    // Ascending sort by slug → "a-first" before "z-last".
    await user.click(header)
    await waitFor(() => {
      expect(headerCell).toHaveAttribute('aria-sort', 'ascending')
    })

    const slugCells = screen.getAllByText(/^(a-first|z-last)$/)
    expect(slugCells[0]).toHaveTextContent('a-first')
    expect(slugCells[1]).toHaveTextContent('z-last')

    // Descending sort → order flips.
    await user.click(header)
    await waitFor(() => {
      expect(headerCell).toHaveAttribute('aria-sort', 'descending')
    })
    const slugCellsDesc = screen.getAllByText(/^(a-first|z-last)$/)
    expect(slugCellsDesc[0]).toHaveTextContent('z-last')
    expect(slugCellsDesc[1]).toHaveTextContent('a-first')
  })

  it('every sortable column header can be sorted', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE, SEQ_INACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A, PRODUCT_B])
    render(renderPage())

    await screen.findByText('welcome-active')

    // Click each sortable header so its accessor runs (product, version, steps, status).
    for (const name of [/product/i, /version/i, /steps/i, /status/i]) {
      const header = screen.getByRole('button', { name })
      const cell = header.closest('th') as HTMLTableCellElement
      await user.click(header)
      await waitFor(() => {
        expect(cell).toHaveAttribute('aria-sort', 'ascending')
      })
    }
    // Both sequences still rendered after sorting.
    expect(screen.getByText('welcome-active')).toBeInTheDocument()
    expect(screen.getByText('old-promo')).toBeInTheDocument()
  })

  it('Export CSV button is enabled with rows and disabled when filtered to empty', async () => {
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')

    const exportBtn = screen.getByRole('button', { name: /export csv/i })
    expect(exportBtn).toBeEnabled()

    const searchBox = screen.getByRole('textbox', { name: /search sequences/i })
    await userEvent.type(searchBox, 'zzz-no-match')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled()
    })
  })

  it('clicking Export CSV triggers a download', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))
    expect(createObjectURL).toHaveBeenCalled()
  })

  it('rejects a definition that parses to an array when editing', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /edit welcome-active/i }))

    const definition = await screen.findByLabelText('Definition JSON')
    fireEvent.change(definition, { target: { value: '[1, 2]' } })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Definition JSON must be an object.')).toBeInTheDocument()
    expect(updateSequence).not.toHaveBeenCalled()
  })

  it('shows the update error message inline when saving a sequence fails', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    updateSequence.mockRejectedValue(new Error('sequence is locked'))
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /edit welcome-active/i }))
    await screen.findByLabelText('Goal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('sequence is locked')
  })

  it('falls back to a generic message when the update failure is not an Error', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    updateSequence.mockRejectedValue('not-an-error')
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /edit welcome-active/i }))
    await screen.findByLabelText('Goal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update sequence')
  })

  it('shows a saving spinner while the sequence update is in flight', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    updateSequence.mockReturnValue(new Promise(() => {}))
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /edit welcome-active/i }))
    await screen.findByLabelText('Goal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const saving = await screen.findByText('Saving')
    expect(saving.closest('button')).toBeDisabled()
  })

  it('requires a slug before creating a sequence', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await screen.findByLabelText('Slug')
    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    expect(await screen.findByText('Slug is required.')).toBeInTheDocument()
    expect(createSequence).not.toHaveBeenCalled()
  })

  it('requires a product when the product list loads after the dialog opens', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    let resolveProducts: (rows: ProductRow[]) => void = () => {}
    getProducts.mockReturnValue(
      new Promise<ProductRow[]>((resolve) => {
        resolveProducts = resolve
      }),
    )
    render(renderPage())

    // Dialog opens while products are still loading, so no product is preselected.
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await user.type(await screen.findByLabelText('Slug'), 'late-product')

    resolveProducts([PRODUCT_A])
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create sequence' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    expect(await screen.findByText('Product is required.')).toBeInTheDocument()
    expect(createSequence).not.toHaveBeenCalled()
  })

  it('rejects invalid definition JSON when creating a sequence', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await user.type(await screen.findByLabelText('Slug'), 'broken-json')
    fireEvent.change(screen.getByLabelText('Definition JSON'), { target: { value: '{bad json' } })

    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    expect(await screen.findByText('Definition JSON is not valid.')).toBeInTheDocument()
    expect(createSequence).not.toHaveBeenCalled()
  })

  it('rejects a definition that parses to an array when creating a sequence', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await user.type(await screen.findByLabelText('Slug'), 'array-def')
    fireEvent.change(screen.getByLabelText('Definition JSON'), { target: { value: '[]' } })

    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    expect(await screen.findByText('Definition JSON must be an object.')).toBeInTheDocument()
    expect(createSequence).not.toHaveBeenCalled()
  })

  it('shows the create error message inline when creating a sequence fails', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    createSequence.mockRejectedValue(new Error('slug already exists'))
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await user.type(await screen.findByLabelText('Slug'), 'welcome-active')
    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('slug already exists')
  })

  it('falls back to a generic message when the create failure is not an Error', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    createSequence.mockRejectedValue('not-an-error')
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await user.type(await screen.findByLabelText('Slug'), 'boom')
    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create sequence')
  })

  it('shows a creating spinner while the sequence create is in flight', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    createSequence.mockReturnValue(new Promise(() => {}))
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /new sequence/i }))
    await user.type(await screen.findByLabelText('Slug'), 'pending-seq')
    await user.click(screen.getByRole('button', { name: 'Create sequence' }))

    const creating = await screen.findByText('Creating')
    expect(creating.closest('button')).toBeDisabled()
  })

  it('shows the delete error message inline when deleting a sequence fails', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    deleteSequence.mockRejectedValue(new Error('sequence has run history'))
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /delete welcome-active/i }))
    await user.click(await screen.findByRole('button', { name: 'Delete sequence' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('sequence has run history')
  })

  it('falls back to a generic message when the delete failure is not an Error', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    deleteSequence.mockRejectedValue('not-an-error')
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /delete welcome-active/i }))
    await user.click(await screen.findByRole('button', { name: 'Delete sequence' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete sequence')
  })

  it('shows a deleting spinner while the sequence delete is in flight', async () => {
    const user = userEvent.setup()
    getSequences.mockResolvedValue([SEQ_ACTIVE])
    getProducts.mockResolvedValue([PRODUCT_A])
    deleteSequence.mockReturnValue(new Promise(() => {}))
    render(renderPage())

    await screen.findByText('welcome-active')
    await user.click(screen.getByRole('button', { name: /delete welcome-active/i }))
    await user.click(await screen.findByRole('button', { name: 'Delete sequence' }))

    const deleting = await screen.findByText('Deleting')
    expect(deleting.closest('button')).toBeDisabled()
  })

  it('StepTable shows dashes for a step missing subject, delay, and skip_if', async () => {
    const user = userEvent.setup()
    // Sequence with steps missing subject and delay — exercises the null fallbacks.
    const seqMinimalSteps: SequenceRow = {
      slug: 'minimal-steps',
      product_id: 'prod_1',
      version: 1,
      is_active: true,
      compiled_at: '2025-01-01T00:00:00Z',
      definition: { steps: [{ skip_if: {} }] },
    }
    getSequences.mockResolvedValue([seqMinimalSteps])
    getProducts.mockResolvedValue([PRODUCT_A])
    render(renderPage())

    const slugBtn = await screen.findByRole('button', { name: /view minimal-steps/i })
    await user.click(slugBtn)

    // Subject, delay, and skip_if should all render as an em dash (null fallback branches).
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(2)
    })
  })
})
