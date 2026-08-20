// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { LeadMagnetRow, ProductRow, SequenceRow } from '../lib/types'
import { ProductsPage } from './ProductsPage'

vi.mock('../lib/api', () => ({
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
  getProducts: vi.fn(),
  getSequences: vi.fn(),
  getLeadMagnets: vi.fn(),
  updateProduct: vi.fn(),
}))

const createProduct = vi.mocked(api.createProduct)
const deleteProduct = vi.mocked(api.deleteProduct)
const getProducts = vi.mocked(api.getProducts)
const getSequences = vi.mocked(api.getSequences)
const getLeadMagnets = vi.mocked(api.getLeadMagnets)
const updateProduct = vi.mocked(api.updateProduct)

const PRODUCT: ProductRow = {
  id: 'prod_1',
  slug: 'acme',
  name: 'Acme Mailer',
  brand_color: '#ff0000',
  default_from_email: 'hi@acme.test',
  default_reply_to: 'reply@acme.test',
  resend_api_key_secret_name: 'RESEND_ACME',
  suppression_scope: 'global',
  firewall_partner_id: 'fw_1',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const PRODUCT_B: ProductRow = {
  id: 'prod_2',
  slug: 'beta',
  name: 'Beta Sender',
  brand_color: '#0000ff',
  default_from_email: 'hello@beta.test',
  default_reply_to: null,
  resend_api_key_secret_name: '',
  suppression_scope: 'product',
  firewall_partner_id: null,
  created_at: '2024-06-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
}

const SEQUENCE: SequenceRow = {
  slug: 'welcome',
  product_id: 'prod_1',
  version: 1,
  is_active: true,
  compiled_at: '2025-01-01T00:00:00Z',
}

const LEAD_MAGNET: LeadMagnetRow = {
  id: 'lm_1',
  product_id: 'prod_1',
  slug: 'guide',
  name: 'Free Guide',
  active: true,
  created_at: '2025-01-01T00:00:00Z',
}

function renderPage(): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <ProductsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  createProduct.mockResolvedValue(PRODUCT)
  updateProduct.mockResolvedValue(PRODUCT)
  deleteProduct.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ProductsPage (interaction)', () => {
  it('shows a skeleton while products are loading', () => {
    getProducts.mockReturnValue(new Promise(() => {}))
    getSequences.mockReturnValue(new Promise(() => {}))
    getLeadMagnets.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // The products table should not exist yet during load.
    expect(container.querySelector('[aria-label="Products"]')).toBeNull()
  })

  it('renders a product row with ready counts, firewall badge and reply-to', async () => {
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([SEQUENCE])
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    render(renderPage())

    expect(await screen.findByText('Acme Mailer')).toBeInTheDocument()
    expect(screen.getByText('hi@acme.test')).toBeInTheDocument()
    expect(screen.getByText('Partner guard')).toBeInTheDocument()
    expect(screen.getByText('Blocks all products')).toBeInTheDocument()
    expect(screen.getByText(/Reply-to: reply@acme.test/)).toBeInTheDocument()
    expect(screen.getByText('Email connected')).toBeInTheDocument()
    // Active + total sequence counts and lead-magnet count rendered as numbers.
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3)
  })

  it('formats large counts with a thousands separator', async () => {
    const manySequences: SequenceRow[] = Array.from({ length: 1500 }, (_, i) => ({
      ...SEQUENCE,
      slug: `welcome-${i}`,
    }))
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue(manySequences)
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    render(renderPage())

    expect(await screen.findByText('Acme Mailer')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('1,500').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows "Loading" counts while sequence/lead-magnet queries are pending', async () => {
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockReturnValue(new Promise(() => {}))
    getLeadMagnets.mockReturnValue(new Promise(() => {}))
    render(renderPage())

    expect(await screen.findByText('Acme Mailer')).toBeInTheDocument()
    expect(screen.getAllByText('Loading').length).toBeGreaterThanOrEqual(3)
  })

  it('shows "Unavailable" counts when sequence/lead-magnet queries fail', async () => {
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockRejectedValue(new Error('seq down'))
    getLeadMagnets.mockRejectedValue(new Error('lm down'))
    render(renderPage())

    expect(await screen.findByText('Acme Mailer')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(3)
    })
  })

  it('shows "Email not set up" when no Resend secret is configured', async () => {
    getProducts.mockResolvedValue([PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('Beta Sender')).toBeInTheDocument()
    expect(screen.getByText('Email not set up')).toBeInTheDocument()
    expect(screen.getByText('Blocks this product only')).toBeInTheDocument()
  })

  it('renders the no-data empty state when no products are configured', async () => {
    getProducts.mockResolvedValue([])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('No products yet')).toBeInTheDocument()
    // The search/filter "No products found" state is distinct from no-data.
    expect(screen.queryByText('No products found')).toBeNull()
  })

  it('shows an error state and retries when the retry button is clicked', async () => {
    getProducts.mockRejectedValue(new Error('boom'))
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('We could not load your products.')).toBeInTheDocument()
    const callsBefore = getProducts.mock.calls.length

    const retry = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retry)

    await waitFor(() => {
      expect(getProducts.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('search narrows the table to matching products', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    expect(screen.getByText('Beta Sender')).toBeInTheDocument()

    const searchBox = screen.getByLabelText('Search products')
    await user.type(searchBox, 'beta')

    await waitFor(() => expect(screen.queryByText('Acme Mailer')).toBeNull())
    expect(screen.getByText('Beta Sender')).toBeInTheDocument()
  })

  it('search matches on the from-email address', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    const searchBox = screen.getByLabelText('Search products')
    await user.type(searchBox, 'hello@beta')

    await waitFor(() => expect(screen.queryByText('Acme Mailer')).toBeNull())
    expect(screen.getByText('Beta Sender')).toBeInTheDocument()
  })

  it('shows "No products found" when the search yields no rows', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    const searchBox = screen.getByLabelText('Search products')
    await user.type(searchBox, 'zzz-no-match')

    await waitFor(() => expect(screen.getByText('No products found')).toBeInTheDocument())
    expect(screen.queryByText('Acme Mailer')).toBeNull()
    // Distinct from the no-data-yet state.
    expect(screen.queryByText('No products yet')).toBeNull()
  })

  it('filters by suppression scope via the Select', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    expect(screen.getByText('Beta Sender')).toBeInTheDocument()

    const trigger = screen.getByRole('combobox', {
      name: /filter products by suppression scope/i,
    })
    await user.click(trigger)
    // "Blocks all products" is the global-scope option.
    await user.click(await screen.findByRole('option', { name: /blocks all products/i }))

    await waitFor(() => expect(screen.queryByText('Beta Sender')).toBeNull())
    expect(screen.getByText('Acme Mailer')).toBeInTheDocument()
  })

  it('selecting "All scopes" after a scope filter shows all products again', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')

    const trigger = screen.getByRole('combobox', {
      name: /filter products by suppression scope/i,
    })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /blocks all products/i }))
    await waitFor(() => expect(screen.queryByText('Beta Sender')).toBeNull())

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /all scopes/i }))
    await waitFor(() => expect(screen.getByText('Beta Sender')).toBeInTheDocument())
    expect(screen.getByText('Acme Mailer')).toBeInTheDocument()
  })

  it('clicking a sortable header toggles aria-sort and reorders rows', async () => {
    const user = userEvent.setup()
    // names: Acme Mailer, Beta Sender — ascending keeps Acme first; created_at
    // ascending puts Beta (2024) before Acme (2025).
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')

    const createdHeader = screen.getByRole('button', { name: /created/i })
    const headerCell = createdHeader.closest('th') as HTMLTableCellElement
    expect(headerCell).toHaveAttribute('aria-sort', 'none')

    await user.click(createdHeader)
    expect(headerCell).toHaveAttribute('aria-sort', 'ascending')

    const bodyText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    const betaIdx = bodyText.findIndex((t) => t.includes('Beta Sender'))
    const acmeIdx = bodyText.findIndex((t) => t.includes('Acme Mailer'))
    expect(betaIdx).toBeLessThan(acmeIdx)
  })

  it('sorting by Product, Slug, and Scope headers reorders rows', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT_B, PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')

    // Product (name accessor): ascending puts Acme before Beta.
    const nameHeader = screen.getByRole('button', { name: /^Product$/ })
    await user.click(nameHeader)
    expect(nameHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    let bodyText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(bodyText.findIndex((t) => t.includes('Acme Mailer'))).toBeLessThan(
      bodyText.findIndex((t) => t.includes('Beta Sender')),
    )

    // Slug (slug accessor): ascending puts acme before beta.
    const slugHeader = screen.getByRole('button', { name: /slug/i })
    await user.click(slugHeader)
    expect(slugHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending')

    // Scope (suppression_scope accessor): ascending puts global before product.
    const scopeHeader = screen.getByRole('button', { name: /scope/i })
    await user.click(scopeHeader)
    expect(scopeHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    bodyText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(bodyText.findIndex((t) => t.includes('Acme Mailer'))).toBeLessThan(
      bodyText.findIndex((t) => t.includes('Beta Sender')),
    )
  })

  it('Export CSV button is enabled with rows and disabled when filtered to empty', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    const exportBtn = screen.getByRole('button', { name: /export csv/i })
    expect(exportBtn).toBeEnabled()

    const searchBox = screen.getByLabelText('Search products')
    await user.type(searchBox, 'zzz-no-match')
    await waitFor(() => expect(exportBtn).toBeDisabled())
  })

  it('clicking Export CSV builds a download exercising every column accessor', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    const origCreate = globalThis.URL.createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    try {
      const user = userEvent.setup()
      getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
      getSequences.mockResolvedValue([])
      getLeadMagnets.mockResolvedValue([])
      render(renderPage())

      await screen.findByText('Acme Mailer')
      const exportBtn = screen.getByRole('button', { name: /export csv/i })
      await user.click(exportBtn)

      expect(createObjectURL).toHaveBeenCalled()
    } finally {
      globalThis.URL.createObjectURL = origCreate
      globalThis.URL.revokeObjectURL = origRevoke
    }
  })

  it('renders both products in the table when data loads', async () => {
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    const table = screen.getByRole('table', { name: 'Products' })
    expect(within(table).getByText('acme')).toBeInTheDocument()
    expect(within(table).getByText('beta')).toBeInTheDocument()
  })

  it('creates a product from the toolbar dialog', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    createProduct.mockResolvedValue({
      ...PRODUCT_B,
      id: 'prod_new',
      slug: 'new-product',
      name: 'New Product',
      default_from_email: 'hello@new.test',
    })
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /new product/i }))
    await user.type(await screen.findByLabelText('Name'), 'New Product')
    await user.type(screen.getByLabelText('Slug'), 'new-product')
    await user.type(screen.getByLabelText('From email'), 'hello@new.test')
    await user.type(screen.getByLabelText('Resend secret'), 'RESEND_NEW')
    await user.click(screen.getByRole('button', { name: 'Create product' }))

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledWith({
        slug: 'new-product',
        name: 'New Product',
        brand_color: '#000000',
        default_from_email: 'hello@new.test',
        default_reply_to: null,
        resend_api_key_secret_name: 'RESEND_NEW',
        suppression_scope: 'product',
        firewall_partner_id: null,
      })
    })
  })

  it('edits an existing product row', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    updateProduct.mockResolvedValue({ ...PRODUCT, name: 'Acme Updated' })
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /edit acme/i }))
    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Acme Updated')
    await user.click(screen.getByRole('button', { name: 'Save product' }))

    await waitFor(() => {
      expect(updateProduct).toHaveBeenCalledWith('prod_1', {
        slug: 'acme',
        name: 'Acme Updated',
        brand_color: '#ff0000',
        default_from_email: 'hi@acme.test',
        default_reply_to: 'reply@acme.test',
        resend_api_key_secret_name: 'RESEND_ACME',
        suppression_scope: 'global',
        firewall_partner_id: 'fw_1',
      })
    })
  })

  it('deletes a product after confirmation', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /delete acme/i }))
    await user.click(await screen.findByRole('button', { name: /^delete product$/i }))

    await waitFor(() => {
      expect(deleteProduct).toHaveBeenCalledWith('prod_1')
    })
  })

  it('changes suppression scope and partner guard before saving a new product', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /new product/i }))

    await user.type(await screen.findByLabelText('Name'), 'Gamma Sender')
    await user.type(screen.getByLabelText('Slug'), 'gamma')
    await user.type(screen.getByLabelText('From email'), 'hello@gamma.test')
    await user.type(screen.getByLabelText('Reply-to email'), 'reply@gamma.test')
    await user.type(screen.getByLabelText('Resend secret'), 'RESEND_GAMMA')

    // Native <select> onChange handlers for scope and partner guard.
    await user.selectOptions(screen.getByLabelText('Suppression scope'), 'global')
    await user.selectOptions(screen.getByLabelText('Partner guard'), 'prod_2')

    await user.click(screen.getByRole('button', { name: 'Create product' }))

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledWith({
        slug: 'gamma',
        name: 'Gamma Sender',
        brand_color: '#000000',
        default_from_email: 'hello@gamma.test',
        default_reply_to: 'reply@gamma.test',
        resend_api_key_secret_name: 'RESEND_GAMMA',
        suppression_scope: 'global',
        firewall_partner_id: 'prod_2',
      })
    })
  })

  it('shows the create error message inline when saving a product fails', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    createProduct.mockRejectedValue(new Error('slug already taken'))
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /new product/i }))
    await user.type(await screen.findByLabelText('Name'), 'Dupe')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create product' }))

    // The mutation onError handler surfaces the message and keeps the dialog open.
    expect(await screen.findByRole('alert')).toHaveTextContent('slug already taken')
    expect(screen.getByRole('button', { name: 'Create product' })).toBeInTheDocument()
  })

  it('falls back to a generic message when the save failure is not an Error', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    updateProduct.mockRejectedValue('not-an-error')
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /edit acme/i }))
    await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: 'Save product' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save product')
  })

  it('shows a saving spinner while the product save is in flight', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    createProduct.mockReturnValue(new Promise(() => {}))
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /new product/i }))
    await user.type(await screen.findByLabelText('Name'), 'Pending Product')
    await user.click(screen.getByRole('button', { name: 'Create product' }))

    const saving = await screen.findByText('Saving')
    expect(saving).toBeInTheDocument()
    expect(saving.closest('button')).toBeDisabled()
  })

  it('shows the delete error message inline when deleting a product fails', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    deleteProduct.mockRejectedValue(new Error('product is still in use'))
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /delete acme/i }))
    await user.click(await screen.findByRole('button', { name: /^delete product$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('product is still in use')
  })

  it('falls back to a generic message when the delete failure is not an Error', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    deleteProduct.mockRejectedValue('not-an-error')
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /delete acme/i }))
    await user.click(await screen.findByRole('button', { name: /^delete product$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete product')
  })

  it('shows a deleting spinner while the product delete is in flight', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getSequences.mockResolvedValue([])
    getLeadMagnets.mockResolvedValue([])
    deleteProduct.mockReturnValue(new Promise(() => {}))
    render(renderPage())

    await screen.findByText('Acme Mailer')
    await user.click(screen.getByRole('button', { name: /delete acme/i }))
    await user.click(await screen.findByRole('button', { name: /^delete product$/i }))

    const deleting = await screen.findByText('Deleting')
    expect(deleting).toBeInTheDocument()
    expect(deleting.closest('button')).toBeDisabled()
  })
})
