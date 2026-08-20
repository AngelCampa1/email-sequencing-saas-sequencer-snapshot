// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { ProductRow, SuppressionRow } from '../lib/types'
import { SuppressionsPage } from './SuppressionsPage'

vi.mock('../lib/api', () => ({
  getSuppressions: vi.fn(),
  getProducts: vi.fn(),
  addSuppression: vi.fn(),
  removeSuppression: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const getSuppressions = vi.mocked(api.getSuppressions)
const getProducts = vi.mocked(api.getProducts)
const addSuppression = vi.mocked(api.addSuppression)
const removeSuppression = vi.mocked(api.removeSuppression)

const PRODUCT: ProductRow = {
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

const GLOBAL_SUPPRESSION: SuppressionRow = {
  id: 'supp_g1',
  email: 'global@example.com',
  scope: 'global',
  product_id: null,
  reason: 'test reason',
  source: 'manual',
  created_at: '2026-05-01T00:00:00Z',
}

const PRODUCT_SUPPRESSION: SuppressionRow = {
  id: 'supp_p1',
  email: 'product@example.com',
  scope: 'product',
  product_id: 'prod_1',
  reason: null,
  source: 'bounce',
  created_at: '2026-05-02T00:00:00Z',
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage(initialSearch = ''): ReactElement {
  const qc = makeClient()
  return (
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <QueryClientProvider client={qc}>
        <SuppressionsPage />
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

describe('SuppressionsPage interaction — loading', () => {
  it('shows skeleton while both queries are loading', () => {
    getSuppressions.mockReturnValue(new Promise(() => {}))
    getProducts.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // When both global and product are loading → TableSkeleton
    expect(container.querySelector('table[aria-label]')).toBeNull()
  })
})

describe('SuppressionsPage interaction — empty state', () => {
  it('shows empty state when no suppressions exist', async () => {
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('No blocked addresses yet')).toBeInTheDocument()
  })
})

describe('SuppressionsPage interaction — data render', () => {
  it('renders global suppression rows in the global tab', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('global@example.com')).toBeInTheDocument()
    expect(screen.getByText('Added by hand')).toBeInTheDocument()
  })

  it('shows product name in table when product_id matches known product', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'product') return [PRODUCT_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    // Switch to product tab
    const productTab = await screen.findByRole('tab', { name: /one product/i })
    await userEvent.click(productTab)

    expect(await screen.findByText('product@example.com')).toBeInTheDocument()
    expect(screen.getByText('Acme Mailer')).toBeInTheDocument()
  })

  it('falls back to product_id when product not in products list', async () => {
    const orphanSuppression: SuppressionRow = {
      ...PRODUCT_SUPPRESSION,
      id: 'supp_orphan',
      product_id: 'prod_orphan',
    }
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'product') return [orphanSuppression]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    const productTab = await screen.findByRole('tab', { name: /one product/i })
    await userEvent.click(productTab)

    expect(await screen.findByText('product@example.com')).toBeInTheDocument()
    expect(screen.getByText('prod_orphan')).toBeInTheDocument()
  })

  it('shows dash for null reason', async () => {
    const noReason: SuppressionRow = {
      ...GLOBAL_SUPPRESSION,
      id: 'supp_noreason',
      reason: null,
    }
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [noReason]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('SuppressionsPage interaction — error + retry', () => {
  it('shows error when both queries fail and retry refetches', async () => {
    getSuppressions.mockRejectedValue(new Error('network error'))
    getProducts.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('We could not load the block list.')).toBeInTheDocument()
    const callsBefore = getSuppressions.mock.calls.length

    // Multiple retry buttons may appear (one banner + one per tab); click the first
    const retryBtns = await screen.findAllByRole('button', { name: /retry/i })
    await userEvent.click(retryBtns[0])

    await waitFor(() => {
      expect(getSuppressions.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('shows partial error when only global query fails and retry refetches global', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') throw new Error('global failed')
      return [PRODUCT_SUPPRESSION]
    })
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    // "Failed to load global suppressions" may appear more than once (banner + tab content)
    const errors = await screen.findAllByText('We could not load the all-products list.')
    expect(errors.length).toBeGreaterThanOrEqual(1)

    const callsBefore = getSuppressions.mock.calls.length
    // Click the first Retry button (banner-level global-only error)
    const retryBtns = screen.getAllByRole('button', { name: /retry/i })
    await userEvent.click(retryBtns[0])

    await waitFor(() => {
      expect(getSuppressions.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('shows partial error when only product query fails and retry refetches product', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'product') throw new Error('product failed')
      return [GLOBAL_SUPPRESSION]
    })
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    expect(await screen.findByText('We could not load the one-product list.')).toBeInTheDocument()

    const callsBefore = getSuppressions.mock.calls.length
    // Switch to product tab to expose the in-tab retry and then click it
    const productTab = screen.getByRole('tab', { name: /one product/i })
    await userEvent.click(productTab)

    const retryBtns = await screen.findAllByRole('button', { name: /retry/i })
    await userEvent.click(retryBtns[0])

    await waitFor(() => {
      expect(getSuppressions.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('retries global query from inside the global tab error panel', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') throw new Error('global tab error')
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    // Both errors fire (global + global-in-tab), multiple retry buttons available
    await screen.findAllByText('We could not load the all-products list.')

    const callsBefore = getSuppressions.mock.calls.length
    const retryBtns = screen.getAllByRole('button', { name: /retry/i })
    // Click the last retry button which is the one inside the global tab panel
    await userEvent.click(retryBtns[retryBtns.length - 1])

    await waitFor(() => {
      expect(getSuppressions.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('retries product query from inside the product tab error panel', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'product') throw new Error('product tab error')
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('We could not load the one-product list.')).toBeInTheDocument()

    // Switch to product tab to make the in-tab retry visible
    const productTab = screen.getByRole('tab', { name: /one product/i })
    await userEvent.click(productTab)

    const callsBefore = getSuppressions.mock.calls.length
    const retryBtns = await screen.findAllByRole('button', { name: /retry/i })
    await userEvent.click(retryBtns[retryBtns.length - 1])

    await waitFor(() => {
      expect(getSuppressions.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})

describe('SuppressionsPage interaction — tab switch', () => {
  it('switches to per-product tab and back', async () => {
    const user = userEvent.setup()
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return [PRODUCT_SUPPRESSION]
    })
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    await screen.findByText('global@example.com')

    const productTab = screen.getByRole('tab', { name: /one product/i })
    await user.click(productTab)

    expect(await screen.findByText('product@example.com')).toBeInTheDocument()

    const globalTab = screen.getByRole('tab', { name: /all products/i })
    await user.click(globalTab)

    expect(await screen.findByText('global@example.com')).toBeInTheDocument()
  })
})

async function openAddDialog() {
  // The trigger button text is "Block an address" — click it to open the dialog
  const addBtn = screen.getByRole('button', { name: /block an address/i })
  await userEvent.click(addBtn)
  // Wait for the dialog to appear — check for the email input which is unique to the dialog
  return screen.findByLabelText(/email \*/i)
}

describe('SuppressionsPage interaction — add suppression dialog', () => {
  it('opens the add suppression dialog', async () => {
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    await screen.findByText('No blocked addresses yet')
    await openAddDialog()

    expect(screen.getByLabelText(/email \*/i)).toBeInTheDocument()
  })

  it('submits global suppression successfully and shows toast', async () => {
    const { toast } = await import('sonner')
    addSuppression.mockResolvedValue(undefined)
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')
    await openAddDialog()

    const emailInput = screen.getByLabelText(/email \*/i)
    await userEvent.type(emailInput, 'test@example.com')

    // Scope is already 'global' by default — submit directly
    const submitBtn = screen.getByRole('button', { name: /^block address$/i })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(addSuppression).toHaveBeenCalled()
      expect(addSuppression.mock.calls[0][0]).toMatchObject({
        email: 'test@example.com',
        scope: 'global',
        product_id: undefined,
        reason: undefined,
      })
    })

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Address blocked')
    })
  })

  it('shows error toast when add suppression fails', async () => {
    const { toast } = await import('sonner')
    addSuppression.mockRejectedValue(new Error('already suppressed'))
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')
    await openAddDialog()

    await userEvent.type(screen.getByLabelText(/email \*/i), 'bad@example.com')

    const submitBtn = screen.getByRole('button', { name: /^block address$/i })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('already suppressed')
    })
  })

  it('shows inline error when add mutation fails', async () => {
    addSuppression.mockRejectedValue(new Error('duplicate entry'))
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')
    await openAddDialog()

    await userEvent.type(screen.getByLabelText(/email \*/i), 'dup@example.com')
    await userEvent.click(screen.getByRole('button', { name: /^block address$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('closes dialog when Cancel is clicked', async () => {
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')
    await openAddDialog()

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByLabelText(/email \*/i)).not.toBeInTheDocument()
    })
  })

  it('typing a reason includes it in the mutation call', async () => {
    addSuppression.mockResolvedValue(undefined)
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')
    await openAddDialog()

    await userEvent.type(screen.getByLabelText(/email \*/i), 'reason@example.com')
    await userEvent.type(screen.getByPlaceholderText(/optional note/i), 'spam complaint')
    await userEvent.click(screen.getByRole('button', { name: /^block address$/i }))

    await waitFor(() => {
      expect(addSuppression).toHaveBeenCalled()
      expect(addSuppression.mock.calls[0][0]).toMatchObject({
        email: 'reason@example.com',
        scope: 'global',
        product_id: undefined,
        reason: 'spam complaint',
      })
    })
  })
})

describe('SuppressionsPage interaction — remove suppression', () => {
  it('opens remove confirmation dialog and confirms removal', async () => {
    removeSuppression.mockResolvedValue({ ok: true })
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    const removeBtn = screen.getByRole('button', { name: /^unblock$/i })
    await userEvent.click(removeBtn)

    // Confirm dialog appears
    expect(await screen.findByText(/unblock this address\?/i)).toBeInTheDocument()

    // Click the destructive confirm button inside the dialog
    const confirmBtns = screen.getAllByRole('button', { name: /^unblock$/i })
    const confirmBtn = confirmBtns[confirmBtns.length - 1]
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(removeSuppression).toHaveBeenCalledWith('supp_g1')
    })
  })

  it('shows toast success after removal', async () => {
    const { toast } = await import('sonner')
    removeSuppression.mockResolvedValue({ ok: true })
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    await userEvent.click(screen.getByRole('button', { name: /^unblock$/i }))
    await screen.findByText(/unblock this address\?/i)

    const confirmBtns = screen.getAllByRole('button', { name: /^unblock$/i })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Address unblocked')
    })
  })

  it('shows error toast when removal fails', async () => {
    const { toast } = await import('sonner')
    removeSuppression.mockRejectedValue(new Error('cannot remove'))
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    await userEvent.click(screen.getByRole('button', { name: /^unblock$/i }))
    await screen.findByText(/unblock this address\?/i)

    const confirmBtns = screen.getAllByRole('button', { name: /^unblock$/i })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('cannot remove')
    })
  })

  it('cancels the remove dialog without calling removeSuppression', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    await userEvent.click(screen.getByRole('button', { name: /^unblock$/i }))
    await screen.findByText(/unblock this address\?/i)

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByText(/unblock this address\?/i)).not.toBeInTheDocument()
    })
    expect(removeSuppression).not.toHaveBeenCalled()
  })
})

describe('SuppressionsPage interaction — add suppression with product scope', () => {
  it('shows product selector when scope is switched to product', async () => {
    const user = userEvent.setup()
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')

    await openAddDialog()

    // Open scope select
    const scopeTrigger = screen.getByRole('combobox', { name: /where it applies/i })
    await user.click(scopeTrigger)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /one product/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('option', { name: /one product/i }))

    // Product selector label should now appear after scope switches to 'product'
    expect(await screen.findByLabelText(/product \*/i)).toBeInTheDocument()
  })

  it('submits product-scoped suppression with product_id', async () => {
    const user = userEvent.setup()
    addSuppression.mockResolvedValue(undefined)
    getSuppressions.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    render(renderPage())
    await screen.findByText('No blocked addresses yet')

    await openAddDialog()

    await user.type(screen.getByLabelText(/email \*/i), 'prod@example.com')

    // Switch to product scope
    const scopeTrigger = screen.getByRole('combobox', { name: /where it applies/i })
    await user.click(scopeTrigger)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /one product/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: /one product/i }))

    // Open product select and pick the product
    const productTrigger = await screen.findByRole('combobox', { name: /product/i })
    await user.click(productTrigger)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Acme Mailer' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'Acme Mailer' }))

    const submitBtn = screen.getByRole('button', { name: /^block address$/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(addSuppression).toHaveBeenCalled()
      expect(addSuppression.mock.calls[0][0]).toMatchObject({
        email: 'prod@example.com',
        scope: 'product',
        product_id: 'prod_1',
        reason: undefined,
      })
    })
  })
})

function makeRows(n: number, prefix = 'row'): SuppressionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    ...GLOBAL_SUPPRESSION,
    id: `${prefix}_${i}`,
    email: `${prefix}-${i}@example.com`,
  }))
}

describe('SuppressionsPage interaction — search', () => {
  it('debounced search passes q to getSuppressions', async () => {
    const user = userEvent.setup()
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    const searchBox = screen.getByLabelText('Search blocked addresses for all products')
    await user.type(searchBox, 'global')

    await waitFor(() => {
      expect(getSuppressions).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'global', q: 'global' }),
      )
    })
  })
})

describe('SuppressionsPage interaction — pagination', () => {
  it('Next and Prev change the offset', async () => {
    const user = userEvent.setup()
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return makeRows(100, 'g')
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('g-0@example.com')

    const next = screen.getByRole('button', { name: /next page/i })
    await user.click(next)

    await waitFor(() => {
      expect(getSuppressions).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'global', offset: 100 }),
      )
    })

    const prev = screen.getByRole('button', { name: /previous page/i })
    await user.click(prev)

    await waitFor(() => {
      const offsets = getSuppressions.mock.calls.map((c) => c[0]?.offset).filter((o) => o === 0)
      expect(offsets.length).toBeGreaterThan(0)
    })
  })
})

describe('SuppressionsPage interaction — CSV export', () => {
  it('shows an enabled Export CSV button when rows exist', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    const exportBtn = screen.getAllByRole('button', { name: /export csv/i })[0]
    expect(exportBtn).toBeEnabled()
  })

  it('clicking Export CSV triggers a download with the row data', async () => {
    const user = userEvent.setup()
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [PRODUCT_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([PRODUCT])
    render(renderPage())

    await screen.findByText('product@example.com')

    let capturedBlob: Blob | undefined
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    })
    const revokeObjectURL = vi.fn()
    const origCreate = globalThis.URL.createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    const exportBtn = screen.getAllByRole('button', { name: /export csv/i })[0]
    await user.click(exportBtn)

    expect(createObjectURL).toHaveBeenCalled()

    // The Product column must export the product NAME (matching the table),
    // not the raw product_id UUID.
    const csvText = await capturedBlob?.text()
    expect(csvText).toContain('Acme Mailer')
    expect(csvText).not.toContain('prod_1')

    globalThis.URL.createObjectURL = origCreate
    globalThis.URL.revokeObjectURL = origRevoke
  })
})

describe('SuppressionsPage interaction — sortable headers', () => {
  it('clicking the Email header sorts the rows', async () => {
    const user = userEvent.setup()
    const rowB: SuppressionRow = { ...GLOBAL_SUPPRESSION, id: 'sb', email: 'b@example.com' }
    const rowA: SuppressionRow = { ...GLOBAL_SUPPRESSION, id: 'sa', email: 'a@example.com' }
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [rowB, rowA]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('b@example.com')

    const emailHeader = screen.getByRole('button', { name: /^email$/i })
    await user.click(emailHeader)

    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      // first data row (index 1, after header) should be a@example.com after asc sort
      expect(rows[1]).toHaveTextContent('a@example.com')
    })
  })
})

describe('SuppressionsPage interaction — bulk unblock', () => {
  it('hides the bulk bar when nothing is selected', async () => {
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return [GLOBAL_SUPPRESSION]
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('global@example.com')

    expect(screen.queryByRole('button', { name: /unblock selected/i })).not.toBeInTheDocument()
  })

  it('select-all then Unblock selected removes each id and shows success toast', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    removeSuppression.mockResolvedValue({ ok: true })
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return makeRows(3, 'b')
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('b-0@example.com')

    const selectAll = screen.getByLabelText('Select all blocked addresses')
    await user.click(selectAll)

    const bulkBtn = await screen.findByRole('button', { name: /unblock selected/i })
    await user.click(bulkBtn)

    await waitFor(() => {
      expect(removeSuppression).toHaveBeenCalledWith('b_0')
      expect(removeSuppression).toHaveBeenCalledWith('b_1')
      expect(removeSuppression).toHaveBeenCalledWith('b_2')
    })

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Unblocked 3 addresses')
    })
  })

  it('shows an error toast when bulk unblock fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    removeSuppression.mockRejectedValue(new Error('bulk failed'))
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return makeRows(2, 'e')
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('e-0@example.com')

    await user.click(screen.getByLabelText('Select all blocked addresses'))
    await user.click(await screen.findByRole('button', { name: /unblock selected/i }))

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('bulk failed')
    })
  })

  it('selecting a single row enables Unblock selected for just that id', async () => {
    const user = userEvent.setup()
    removeSuppression.mockResolvedValue({ ok: true })
    getSuppressions.mockImplementation(async (params) => {
      if (params?.scope === 'global') return makeRows(2, 's')
      return []
    })
    getProducts.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('s-0@example.com')

    await user.click(screen.getByLabelText('Select s-0@example.com'))

    const bulkBtn = await screen.findByRole('button', { name: /unblock selected/i })
    await user.click(bulkBtn)

    await waitFor(() => {
      expect(removeSuppression).toHaveBeenCalledWith('s_0')
    })
    expect(removeSuppression).not.toHaveBeenCalledWith('s_1')
  })
})
