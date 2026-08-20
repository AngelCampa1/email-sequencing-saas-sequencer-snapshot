// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { LeadMagnetRow, ProductRow } from '../lib/types'
import { EditLeadMagnetDialog, LeadMagnetsPage, NewLeadMagnetDialog } from './LeadMagnetsPage'

vi.mock('../lib/api', () => ({
  getLeadMagnets: vi.fn(),
  getProducts: vi.fn(),
  createLeadMagnet: vi.fn(),
  deleteLeadMagnet: vi.fn(),
  updateLeadMagnet: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const getLeadMagnets = vi.mocked(api.getLeadMagnets)
const getProducts = vi.mocked(api.getProducts)
const createLeadMagnet = vi.mocked(api.createLeadMagnet)
const deleteLeadMagnet = vi.mocked(api.deleteLeadMagnet)
const updateLeadMagnet = vi.mocked(api.updateLeadMagnet)

const PRODUCT: ProductRow = {
  id: 'prod_1',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT',
  suppression_scope: 'global',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const LEAD_MAGNET: LeadMagnetRow = {
  id: 'lm_1',
  product_id: 'prod_1',
  product_slug: 'camaudit',
  product_name: 'CAMAudit',
  slug: 'tenant-checklist',
  name: 'Tenant Checklist',
  asset_r2_bucket: 'camaudit-assets',
  asset_r2_key: 'tenant-checklist.pdf',
  effective_asset_r2_bucket: 'camaudit-assets',
  asset_status: 'available',
  asset_size: 1200,
  fulfillment_sequence_slug: 'tenant-welcome',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

const INACTIVE_LM: LeadMagnetRow = {
  ...LEAD_MAGNET,
  id: 'lm_2',
  name: 'Old Guide',
  slug: 'old-guide',
  active: false,
  asset_status: 'missing',
}

const PRODUCT_B: ProductRow = {
  ...PRODUCT,
  id: 'prod_2',
  slug: 'floriva-web',
  name: 'Floriva',
}

const LM_OTHER_PRODUCT: LeadMagnetRow = {
  ...LEAD_MAGNET,
  id: 'lm_3',
  name: 'Vendor Pack',
  slug: 'vendor-pack',
  product_id: 'prod_2',
  product_slug: 'floriva-web',
  product_name: 'Floriva',
  asset_size: 50,
}

// A row with every nullable/optional field absent and a product_id that is
// NOT present in the products list — exercises the `?? fallback` default sides
// of the sort/CSV accessors, the product-filter orphan keying, and the search
// haystack fallbacks (product_slug/product_name/productMap lookups all empty).
const ORPHAN_LM: LeadMagnetRow = {
  id: 'lm_orphan',
  product_id: 'prod_unknown',
  slug: 'orphan-magnet',
  name: 'Orphan Magnet',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// LeadMagnetsPage — error + retry
// ---------------------------------------------------------------------------

describe('LeadMagnetsPage error + retry', () => {
  it('shows error state and re-calls getLeadMagnets on Retry click', async () => {
    getLeadMagnets.mockRejectedValue(new Error('D1 down'))
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)

    expect(await screen.findByText('Failed to load lead magnets')).toBeInTheDocument()
    const callsBefore = getLeadMagnets.mock.calls.length

    const retry = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retry)

    await waitFor(() => {
      expect(getLeadMagnets.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})

// ---------------------------------------------------------------------------
// ToggleActiveButton — click fires updateLeadMagnet
// ---------------------------------------------------------------------------

describe('ToggleActiveButton', () => {
  it('calls updateLeadMagnet with active:false when toggling an active lead magnet', async () => {
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])
    updateLeadMagnet.mockResolvedValue({ ...LEAD_MAGNET, active: false })

    wrap(<LeadMagnetsPage />)

    const deactivate = await screen.findByRole('button', { name: 'Deactivate' })
    await userEvent.click(deactivate)

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledWith('lm_1', { active: false })
    })
  })

  it('calls updateLeadMagnet with active:true when toggling an inactive lead magnet', async () => {
    getLeadMagnets.mockResolvedValue([INACTIVE_LM])
    getProducts.mockResolvedValue([PRODUCT])
    updateLeadMagnet.mockResolvedValue({ ...INACTIVE_LM, active: true })

    wrap(<LeadMagnetsPage />)

    const activate = await screen.findByRole('button', { name: 'Activate' })
    await userEvent.click(activate)

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledWith('lm_2', { active: true })
    })
  })

  it('shows toast.error when toggle fails', async () => {
    const { toast } = await import('sonner')
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])
    updateLeadMagnet.mockRejectedValue(new Error('network error'))

    wrap(<LeadMagnetsPage />)

    const deactivate = await screen.findByRole('button', { name: 'Deactivate' })
    await userEvent.click(deactivate)

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('network error')
    })
  })
})

// ---------------------------------------------------------------------------
// EditLeadMagnetDialog — open, edit, submit, cancel
// ---------------------------------------------------------------------------

describe('EditLeadMagnetDialog (interaction)', () => {
  it('opens dialog and shows current asset key', async () => {
    updateLeadMagnet.mockResolvedValue(LEAD_MAGNET)

    wrap(<EditLeadMagnetDialog lm={LEAD_MAGNET} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByLabelText(/File name/i)).toHaveValue('tenant-checklist.pdf')
  })

  it('submits with updated asset key', async () => {
    updateLeadMagnet.mockResolvedValue(LEAD_MAGNET)

    wrap(<EditLeadMagnetDialog lm={LEAD_MAGNET} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const input = await screen.findByLabelText(/File name/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'new-file.pdf')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledWith(
        'lm_1',
        expect.objectContaining({ asset_r2_key: 'new-file.pdf' }),
      )
    })
  })

  it('clears asset_r2_key when input is blank (trims to empty)', async () => {
    updateLeadMagnet.mockResolvedValue(LEAD_MAGNET)

    wrap(<EditLeadMagnetDialog lm={LEAD_MAGNET} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const input = await screen.findByLabelText(/File name/i)
    await userEvent.clear(input)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledWith(
        'lm_1',
        expect.objectContaining({ asset_r2_key: null }),
      )
    })
  })

  it('toggles the active checkbox', async () => {
    updateLeadMagnet.mockResolvedValue({ ...LEAD_MAGNET, active: false })

    wrap(<EditLeadMagnetDialog lm={LEAD_MAGNET} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).toBeChecked()
    await userEvent.click(checkbox)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledWith(
        'lm_1',
        expect.objectContaining({ active: false }),
      )
    })
  })

  it('shows inline error when mutation fails', async () => {
    updateLeadMagnet.mockRejectedValue(new Error('save failed'))

    wrap(<EditLeadMagnetDialog lm={LEAD_MAGNET} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await screen.findByLabelText(/File name/i)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('save failed')).toBeInTheDocument()
  })

  it('resets form state when dialog is reopened after successful edit', async () => {
    updateLeadMagnet.mockResolvedValue(LEAD_MAGNET)

    wrap(<EditLeadMagnetDialog lm={LEAD_MAGNET} />)

    // Open dialog
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    // Mutate input
    const input = await screen.findByLabelText(/File name/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'changed.pdf')

    // Close via Cancel
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Reopen: handleOpenChange(true) resets fields to lm values
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByLabelText(/File name/i)).toHaveValue('tenant-checklist.pdf')
  })
})

// ---------------------------------------------------------------------------
// NewLeadMagnetDialog — validation, reset, submit
// ---------------------------------------------------------------------------

describe('NewLeadMagnetDialog (interaction)', () => {
  it('shows validation error when required fields are missing', async () => {
    wrap(<NewLeadMagnetDialog products={[PRODUCT]} />)

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    // Click Create without filling any field
    await userEvent.click(await screen.findByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Product, slug, and name are required')).toBeInTheDocument()

    // createLeadMagnet must NOT have been called
    expect(createLeadMagnet).not.toHaveBeenCalled()
  })

  it('shows validation error when slug and name are blank but product is provided (via handleOpenChange reset)', async () => {
    wrap(<NewLeadMagnetDialog products={[PRODUCT]} />)

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    // Type into slug then clear it
    const slugInput = await screen.findByLabelText(/^Slug$/i)
    await userEvent.type(slugInput, 'x')
    await userEvent.clear(slugInput)

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Product, slug, and name are required')).toBeInTheDocument()
  })

  it('calls createLeadMagnet with trimmed values when form is valid', async () => {
    createLeadMagnet.mockResolvedValue(LEAD_MAGNET)
    getLeadMagnets.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    // Render full page so both queries resolve and product list is populated
    wrap(<LeadMagnetsPage />)

    // Wait for page to load
    await screen.findByText('No lead magnets yet')

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    const slugInput = await screen.findByLabelText(/^Slug$/i)
    const nameInput = screen.getByLabelText(/^Name$/i)
    const assetInput = screen.getByLabelText(/File name/i)

    await userEvent.type(slugInput, '  my-magnet  ')
    await userEvent.type(nameInput, '  My Magnet  ')
    await userEvent.type(assetInput, 'my-file.pdf')

    // createLeadMagnet requires productId — select via the Select trigger
    // The Select component renders a button with placeholder text
    const selectTrigger = screen.getByRole('combobox')
    await userEvent.click(selectTrigger)
    const option = await screen.findByRole('option', { name: 'CAMAudit' })
    await userEvent.click(option)

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createLeadMagnet).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: 'prod_1',
          slug: 'my-magnet',
          name: 'My Magnet',
          asset_r2_key: 'my-file.pdf',
          active: true,
        }),
        expect.anything(),
      )
    })
  })

  it('calls createLeadMagnet with null asset_r2_key when asset field left blank', async () => {
    createLeadMagnet.mockResolvedValue(LEAD_MAGNET)
    getLeadMagnets.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)
    await screen.findByText('No lead magnets yet')

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    const slugInput = await screen.findByLabelText(/^Slug$/i)
    const nameInput = screen.getByLabelText(/^Name$/i)

    await userEvent.type(slugInput, 'my-magnet')
    await userEvent.type(nameInput, 'My Magnet')

    const selectTrigger = screen.getByRole('combobox')
    await userEvent.click(selectTrigger)
    const option = await screen.findByRole('option', { name: 'CAMAudit' })
    await userEvent.click(option)

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createLeadMagnet).toHaveBeenCalledWith(
        expect.objectContaining({ asset_r2_key: null }),
        expect.anything(),
      )
    })
  })

  it('unchecks active checkbox and passes active:false', async () => {
    createLeadMagnet.mockResolvedValue(LEAD_MAGNET)
    getLeadMagnets.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)
    await screen.findByText('No lead magnets yet')

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    const slugInput = await screen.findByLabelText(/^Slug$/i)
    const nameInput = screen.getByLabelText(/^Name$/i)

    await userEvent.type(slugInput, 'my-magnet')
    await userEvent.type(nameInput, 'My Magnet')

    const selectTrigger = screen.getByRole('combobox')
    await userEvent.click(selectTrigger)
    const option = await screen.findByRole('option', { name: 'CAMAudit' })
    await userEvent.click(option)

    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createLeadMagnet).toHaveBeenCalledWith(
        expect.objectContaining({ active: false }),
        expect.anything(),
      )
    })
  })

  it('resets form when dialog is closed via Cancel', async () => {
    wrap(<NewLeadMagnetDialog products={[PRODUCT]} />)

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    const slugInput = await screen.findByLabelText(/^Slug$/i)
    await userEvent.type(slugInput, 'test-slug')

    // Close with Cancel — triggers handleOpenChange(false) -> resetForm()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Reopen
    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    // Slug should be cleared
    expect(await screen.findByLabelText(/^Slug$/i)).toHaveValue('')
  })

  it('shows inline error when createLeadMagnet mutation fails', async () => {
    createLeadMagnet.mockRejectedValue(new Error('create failed'))
    getLeadMagnets.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)
    await screen.findByText('No lead magnets yet')

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    const slugInput = await screen.findByLabelText(/^Slug$/i)
    const nameInput = screen.getByLabelText(/^Name$/i)

    await userEvent.type(slugInput, 'my-magnet')
    await userEvent.type(nameInput, 'My Magnet')

    const selectTrigger = screen.getByRole('combobox')
    await userEvent.click(selectTrigger)
    const option = await screen.findByRole('option', { name: 'CAMAudit' })
    await userEvent.click(option)

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('create failed')).toBeInTheDocument()
  })

  it('shows the spinner while create is pending', async () => {
    // Never resolves — keeps createMutation.isPending true so the "Creating"
    // spinner branch renders.
    createLeadMagnet.mockReturnValue(new Promise(() => {}))
    getLeadMagnets.mockResolvedValue([])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)
    await screen.findByText('No lead magnets yet')

    await userEvent.click(screen.getByRole('button', { name: /new lead magnet/i }))

    const slugInput = await screen.findByLabelText(/^Slug$/i)
    const nameInput = screen.getByLabelText(/^Name$/i)
    await userEvent.type(slugInput, 'my-magnet')
    await userEvent.type(nameInput, 'My Magnet')

    const selectTrigger = screen.getByRole('combobox')
    await userEvent.click(selectTrigger)
    await userEvent.click(await screen.findByRole('option', { name: 'CAMAudit' }))

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Creating')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// LeadMagnetsPage — quality-of-life toolbar (search, filter, sort, export, bulk)
// ---------------------------------------------------------------------------

describe('LeadMagnetsPage QoL toolbar', () => {
  it('search narrows the table to matching rows', async () => {
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET, LM_OTHER_PRODUCT])
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    expect(screen.getByText('Vendor Pack')).toBeInTheDocument()

    const searchBox = screen.getByLabelText('Search lead magnets')
    await user.type(searchBox, 'vendor')

    await waitFor(() => expect(screen.queryByText('Tenant Checklist')).toBeNull())
    expect(screen.getByText('Vendor Pack')).toBeInTheDocument()
  })

  it('shows "No lead magnets found" when search yields no rows', async () => {
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    const searchBox = screen.getByLabelText('Search lead magnets')
    await user.type(searchBox, 'zzz-no-match')

    await waitFor(() => expect(screen.getByText('No lead magnets found')).toBeInTheDocument())
    expect(screen.queryByText('Tenant Checklist')).toBeNull()
  })

  it('product filter narrows the table to the chosen product', async () => {
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET, LM_OTHER_PRODUCT])
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    expect(screen.getByText('Vendor Pack')).toBeInTheDocument()

    const trigger = screen.getByRole('combobox', { name: /filter lead magnets by product/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Floriva' }))

    await waitFor(() => expect(screen.queryByText('Tenant Checklist')).toBeNull())
    expect(screen.getByText('Vendor Pack')).toBeInTheDocument()
  })

  it('clicking a sortable header toggles aria-sort and reorders rows', async () => {
    const user = userEvent.setup()
    // asset_size: Tenant=1200, Vendor=50 — ascending should put Vendor first
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET, LM_OTHER_PRODUCT])
    getProducts.mockResolvedValue([PRODUCT, PRODUCT_B])

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')

    const nameHeader = screen.getByRole('button', { name: /^name$/i })
    const headerCell = nameHeader.closest('th') as HTMLTableCellElement
    expect(headerCell).toHaveAttribute('aria-sort', 'none')

    const assetHeader = screen.getByRole('button', { name: /^asset$/i })
    const assetCell = assetHeader.closest('th') as HTMLTableCellElement
    await user.click(assetHeader)
    expect(assetCell).toHaveAttribute('aria-sort', 'ascending')

    const bodyText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    const vendorIdx = bodyText.findIndex((t) => t.includes('Vendor Pack'))
    const tenantIdx = bodyText.findIndex((t) => t.includes('Tenant Checklist'))
    expect(vendorIdx).toBeLessThan(tenantIdx)
  })

  it('Export CSV button is present and enabled with rows', async () => {
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    const exportBtn = screen.getByRole('button', { name: /export csv/i })
    expect(exportBtn).toBeEnabled()
  })

  it('clicking Export CSV builds a download', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    const origCreate = globalThis.URL.createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    try {
      const user = userEvent.setup()
      getLeadMagnets.mockResolvedValue([LEAD_MAGNET, INACTIVE_LM])
      getProducts.mockResolvedValue([PRODUCT])

      wrap(<LeadMagnetsPage />)

      await screen.findByText('Tenant Checklist')
      const exportBtn = screen.getByRole('button', { name: /export csv/i })
      await user.click(exportBtn)

      expect(createObjectURL).toHaveBeenCalled()
    } finally {
      globalThis.URL.createObjectURL = origCreate
      globalThis.URL.revokeObjectURL = origRevoke
    }
  })

  it('bulk bar is hidden when nothing is selected', async () => {
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    expect(screen.queryByRole('button', { name: 'Activate selected' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deactivate selected' })).toBeNull()
  })

  it('select-all then "Activate selected" calls updateLeadMagnet once per id with active true', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET, INACTIVE_LM])
    getProducts.mockResolvedValue([PRODUCT])
    updateLeadMagnet.mockResolvedValue(LEAD_MAGNET)

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')

    const selectAll = screen.getByLabelText('Select all lead magnets')
    await user.click(selectAll)

    const activateBtn = await screen.findByRole('button', { name: 'Activate selected' })
    await user.click(activateBtn)

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledTimes(2)
    })
    expect(updateLeadMagnet).toHaveBeenCalledWith('lm_1', { active: true })
    expect(updateLeadMagnet).toHaveBeenCalledWith('lm_2', { active: true })
    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Updated 2 lead magnets')
    })
  })

  it('"Deactivate selected" calls updateLeadMagnet with active false for one selected row', async () => {
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET, INACTIVE_LM])
    getProducts.mockResolvedValue([PRODUCT])
    updateLeadMagnet.mockResolvedValue(LEAD_MAGNET)

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')

    await user.click(screen.getByLabelText('Select Tenant Checklist'))

    const deactivateBtn = await screen.findByRole('button', { name: 'Deactivate selected' })
    await user.click(deactivateBtn)

    await waitFor(() => {
      expect(updateLeadMagnet).toHaveBeenCalledWith('lm_1', { active: false })
    })
    expect(updateLeadMagnet).toHaveBeenCalledTimes(1)
  })

  it('shows toast.error when a bulk update fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])
    updateLeadMagnet.mockRejectedValue(new Error('bulk boom'))

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')

    await user.click(screen.getByLabelText('Select all lead magnets'))
    await user.click(await screen.findByRole('button', { name: 'Activate selected' }))

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('bulk boom')
    })
  })

  it('renders, filters, sorts, and exports a row with all nullable fields empty', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    const origCreate = globalThis.URL.createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    try {
      const user = userEvent.setup()
      // ORPHAN_LM has no product_slug/product_name and a product_id missing from
      // the products list; LEAD_MAGNET is fully populated for contrast.
      getLeadMagnets.mockResolvedValue([LEAD_MAGNET, ORPHAN_LM])
      getProducts.mockResolvedValue([PRODUCT])

      wrap(<LeadMagnetsPage />)

      await screen.findByText('Orphan Magnet')

      // Search by the orphan name — the haystack falls back through the empty
      // product_slug/product_name/productMap branches.
      const searchBox = screen.getByLabelText('Search lead magnets')
      await user.type(searchBox, 'orphan')
      await waitFor(() => expect(screen.queryByText('Tenant Checklist')).toBeNull())
      expect(screen.getByText('Orphan Magnet')).toBeInTheDocument()
      await user.clear(searchBox)
      await screen.findByText('Tenant Checklist')

      // Sort by asset size — the orphan row's null asset_size hits the sort
      // accessor's `?? null` default branch.
      const assetHeader = screen.getByRole('button', { name: /^asset$/i })
      await user.click(assetHeader)

      // Filter to the orphan product — its slug key falls back to product_id.
      const trigger = screen.getByRole('combobox', { name: /filter lead magnets by product/i })
      await user.click(trigger)
      await user.click(await screen.findByRole('option', { name: 'prod_unknown' }))
      await waitFor(() => expect(screen.queryByText('Tenant Checklist')).toBeNull())
      expect(screen.getByText('Orphan Magnet')).toBeInTheDocument()

      // Export — CSV accessors hit their `?? null` default branches for the
      // orphan row's empty product/asset/follow-up fields.
      const exportBtn = screen.getByRole('button', { name: /export csv/i })
      await user.click(exportBtn)
      expect(createObjectURL).toHaveBeenCalled()
    } finally {
      globalThis.URL.createObjectURL = origCreate
      globalThis.URL.revokeObjectURL = origRevoke
    }
  })

  it('shows the spinner while a bulk update is pending', async () => {
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])
    // Never resolves — keeps bulkSetActive.isPending true so the spinner branch
    // ("Updating") renders on both bulk buttons.
    updateLeadMagnet.mockReturnValue(new Promise(() => {}))

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    await user.click(screen.getByLabelText('Select all lead magnets'))
    await user.click(await screen.findByRole('button', { name: 'Activate selected' }))

    await waitFor(() => {
      expect(screen.getAllByText('Updating').length).toBeGreaterThan(0)
    })
  })

  it('deletes a lead magnet after confirmation and refreshes the list', async () => {
    const user = userEvent.setup()
    getLeadMagnets.mockResolvedValue([LEAD_MAGNET])
    getProducts.mockResolvedValue([PRODUCT])
    deleteLeadMagnet.mockResolvedValue({ ok: true })

    wrap(<LeadMagnetsPage />)

    await screen.findByText('Tenant Checklist')
    await user.click(screen.getByRole('button', { name: /delete tenant-checklist/i }))

    expect(await screen.findByText('Delete lead magnet?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^delete lead magnet$/i }))

    await waitFor(() => {
      expect(deleteLeadMagnet).toHaveBeenCalledWith('lm_1')
    })
    await waitFor(() => {
      expect(getLeadMagnets).toHaveBeenCalledTimes(2)
    })
  })
})
