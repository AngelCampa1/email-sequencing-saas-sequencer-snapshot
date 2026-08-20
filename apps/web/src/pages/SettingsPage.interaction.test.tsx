// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { ApiTokenRow, ProductRow } from '../lib/types'
import { SettingsPage } from './SettingsPage'

vi.mock('../lib/api', () => ({
  getProducts: vi.fn(),
  getApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const getProducts = vi.mocked(api.getProducts)
const getApiTokens = vi.mocked(api.getApiTokens)
const createApiToken = vi.mocked(api.createApiToken)
const revokeApiToken = vi.mocked(api.revokeApiToken)

const VALID_CLIENT_ID = '00000000000000000000000000000000.access'

const PRODUCT: ProductRow = {
  id: 'prod_1',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_CAMAUDIT',
  suppression_scope: 'global',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const ACTIVE_TOKEN: ApiTokenRow = {
  id: 'token_1',
  product_id: 'prod_1',
  product_slug: 'camaudit',
  product_name: 'CAMAudit',
  label: 'Prod token',
  access_service_token_id: VALID_CLIENT_ID,
  created_at: '2026-01-01T00:00:00Z',
  revoked_at: null,
  active: true,
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage(client?: QueryClient): ReactElement {
  const qc = client ?? makeClient()
  return (
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Loading / error / retry
// ---------------------------------------------------------------------------

describe('SettingsPage interaction — loading and error states', () => {
  it('shows skeleton while products are loading', () => {
    getProducts.mockReturnValue(new Promise(() => {}))
    getApiTokens.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // No table rendered yet — skeleton placeholder shown
    expect(container.querySelector('[aria-label="Product API tokens"]')).toBeNull()
  })

  it('shows products error and triggers refetch when Retry is clicked', async () => {
    getProducts.mockRejectedValue(new Error('db error'))
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    expect(await screen.findByText('Failed to load products')).toBeInTheDocument()
    const callsBefore = getProducts.mock.calls.length

    // getAllByRole because the error appears in both the tokens card and Resend card
    const retryBtns = screen.getAllByRole('button', { name: /retry/i })
    await userEvent.click(retryBtns[0])

    await waitFor(() => {
      expect(getProducts.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('shows tokens error with retry and still renders product rows', async () => {
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockRejectedValue(new Error('token list unavailable'))
    render(renderPage())

    expect(await screen.findByText('Failed to load API tokens')).toBeInTheDocument()
    // The product name appears in both the tokens table and the Resend config table
    const productCells = await screen.findAllByText('CAMAudit')
    expect(productCells.length).toBeGreaterThanOrEqual(1)

    const callsBefore = getApiTokens.mock.calls.length
    const retryBtn = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retryBtn)

    await waitFor(() => {
      expect(getApiTokens.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('renders product rows when both queries resolve', async () => {
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    render(renderPage())

    // Product name appears in both token table and Resend config — use getAllByText
    const names = await screen.findAllByText('CAMAudit')
    expect(names.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('camaudit').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('1 active')).toBeInTheDocument()
  })

  it('shows empty-state when products list is empty', async () => {
    getProducts.mockResolvedValue([])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    await waitFor(() => {
      const empties = screen.getAllByText('No products configured.')
      expect(empties.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// ---------------------------------------------------------------------------
// TokenDialog — open / cancel / submit success / submit error / invalid input
// ---------------------------------------------------------------------------

describe('SettingsPage interaction — TokenDialog', () => {
  it('opens TokenDialog when Setup Token is clicked', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    expect(await screen.findByText('Service Token - Cloudflare Access')).toBeInTheDocument()
  })

  it('closes TokenDialog when Cancel is clicked', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByText('Service Token - Cloudflare Access')).not.toBeInTheDocument()
    })
  })

  it('shows access client id validation error for a badly-formatted token id', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const accessInput = screen.getByPlaceholderText(VALID_CLIENT_ID)
    await user.type(accessInput, 'invalid-token-id')

    expect(
      await screen.findByText(
        /Use the 32-character Cloudflare Access client id ending in .access/i,
      ),
    ).toBeInTheDocument()
  })

  it('Save Mapping button is disabled when access client id is empty', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const saveBtn = screen.getByRole('button', { name: /save mapping/i })
    expect(saveBtn).toBeDisabled()
  })

  it('submits token mapping successfully and shows toast', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    createApiToken.mockResolvedValue({
      ok: true,
      token: ACTIVE_TOKEN,
    })

    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const accessInput = screen.getByPlaceholderText(VALID_CLIENT_ID)
    await user.type(accessInput, VALID_CLIENT_ID)

    // Re-query button after typing to get fresh enabled state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save mapping/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole('button', { name: /save mapping/i }))

    await waitFor(() => {
      expect(createApiToken).toHaveBeenCalledWith(
        {
          product_id: 'prod_1',
          label: undefined,
          access_service_token_id: VALID_CLIENT_ID,
        },
        expect.anything(),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Token mapping saved')
    })
  })

  it('submits token mapping with a label', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    createApiToken.mockResolvedValue({ ok: true, token: ACTIVE_TOKEN })

    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const labelInput = screen.getByPlaceholderText('camaudit-service-token')
    await user.type(labelInput, 'My prod token')

    const accessInput = screen.getByPlaceholderText(VALID_CLIENT_ID)
    await user.type(accessInput, VALID_CLIENT_ID)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save mapping/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole('button', { name: /save mapping/i }))

    await waitFor(() => {
      expect(createApiToken).toHaveBeenCalledWith(
        {
          product_id: 'prod_1',
          label: 'My prod token',
          access_service_token_id: VALID_CLIENT_ID,
        },
        expect.anything(),
      )
    })
  })

  it('shows submit error in the dialog when createApiToken fails', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    createApiToken.mockRejectedValue(new Error('Duplicate token'))

    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const accessInput = screen.getByPlaceholderText(VALID_CLIENT_ID)
    await user.type(accessInput, VALID_CLIENT_ID)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save mapping/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole('button', { name: /save mapping/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate token')
  })

  it('shows fallback error message when createApiToken rejects with a non-Error', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    createApiToken.mockRejectedValue('string error')

    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const accessInput = screen.getByPlaceholderText(VALID_CLIENT_ID)
    await user.type(accessInput, VALID_CLIENT_ID)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save mapping/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole('button', { name: /save mapping/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save token mapping')
  })

  it('dialog closes after successful submission', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    createApiToken.mockResolvedValue({ ok: true, token: ACTIVE_TOKEN })

    render(renderPage())

    const setupBtn = await screen.findByRole('button', { name: /setup token/i })
    await user.click(setupBtn)

    await screen.findByText('Service Token - Cloudflare Access')

    const accessInput = screen.getByPlaceholderText(VALID_CLIENT_ID)
    await user.type(accessInput, VALID_CLIENT_ID)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save mapping/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole('button', { name: /save mapping/i }))

    await waitFor(() => {
      expect(screen.queryByText('Service Token - Cloudflare Access')).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// RevokeTokenButton — open alert dialog / confirm / cancel / error toast
// ---------------------------------------------------------------------------

describe('SettingsPage interaction — RevokeTokenButton', () => {
  it('opens revoke alert dialog when Revoke button is clicked', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    render(renderPage())

    // Wait until data is loaded — check via the badge
    await screen.findByText('1 active')

    // The Revoke trigger button text is "Revoke" (with ban icon); title attr provides "Revoke Prod token"
    const revokeBtns = screen.getAllByRole('button', { name: /^revoke$/i })
    await user.click(revokeBtns[0])

    expect(await screen.findByText(/Revoke Prod token\?/i)).toBeInTheDocument()
  })

  it('calls revokeApiToken and shows toast.success on confirm', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    revokeApiToken.mockResolvedValue({ ok: true })
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    render(renderPage())

    await screen.findByText('1 active')

    const revokeBtns = screen.getAllByRole('button', { name: /^revoke$/i })
    await user.click(revokeBtns[0])

    await screen.findByText(/Revoke Prod token\?/i)

    // After the dialog opens, there are now multiple "Revoke" buttons (trigger + confirm)
    // The confirm button is the one inside the AlertDialogAction
    const allRevokeAfterOpen = screen.getAllByRole('button', { name: /^revoke$/i })
    const confirmBtn = allRevokeAfterOpen[allRevokeAfterOpen.length - 1]
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(revokeApiToken).toHaveBeenCalledWith('token_1', expect.anything())
    })

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Token "Prod token" revoked')
    })
  })

  it('shows toast.error when revokeApiToken fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    revokeApiToken.mockRejectedValue(new Error('Token already revoked'))
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    render(renderPage())

    await screen.findByText('1 active')

    const revokeBtns = screen.getAllByRole('button', { name: /^revoke$/i })
    await user.click(revokeBtns[0])

    await screen.findByText(/Revoke Prod token\?/i)

    const allRevokeAfterOpen = screen.getAllByRole('button', { name: /^revoke$/i })
    const confirmBtn = allRevokeAfterOpen[allRevokeAfterOpen.length - 1]
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Token already revoked')
    })
  })

  it('shows toast.error with fallback message when error is not an Error object', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    revokeApiToken.mockRejectedValue('unexpected string')
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    render(renderPage())

    await screen.findByText('1 active')

    const revokeBtns = screen.getAllByRole('button', { name: /^revoke$/i })
    await user.click(revokeBtns[0])

    await screen.findByText(/Revoke Prod token\?/i)

    const allRevokeAfterOpen = screen.getAllByRole('button', { name: /^revoke$/i })
    const confirmBtn = allRevokeAfterOpen[allRevokeAfterOpen.length - 1]
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to revoke token')
    })
  })

  it('closes revoke dialog when Cancel is clicked', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([ACTIVE_TOKEN])
    render(renderPage())

    await screen.findByText('1 active')

    const revokeBtns = screen.getAllByRole('button', { name: /^revoke$/i })
    await user.click(revokeBtns[0])

    await screen.findByText(/Revoke Prod token\?/i)

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByText(/Revoke Prod token\?/i)).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// ProductTokenDetails — sorting and revoked date display
// ---------------------------------------------------------------------------

describe('SettingsPage interaction — ProductTokenDetails', () => {
  it('shows revoked date when token has revoked_at', async () => {
    const revokedToken: ApiTokenRow = {
      ...ACTIVE_TOKEN,
      id: 'token_revoked',
      active: false,
      revoked_at: '2026-03-15T00:00:00Z',
      label: 'Old token',
    }
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([revokedToken])
    render(renderPage())

    await screen.findByText('Old token')
    expect(screen.getByText(/Revoked/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Cloudflare setup commands — collapsible disclosure
// ---------------------------------------------------------------------------

describe('SettingsPage interaction — Cloudflare setup disclosure', () => {
  it('expands the command list when the header is clicked', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const trigger = await screen.findByRole('button', { name: /Cloudflare Setup Commands/i })
    // Closed by default.
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })
  })
})

// ---------------------------------------------------------------------------
// Settings search + batch-copy commands
// ---------------------------------------------------------------------------

// `userEvent.setup()` installs its own clipboard stub on `navigator`, so we
// spy on the live `navigator.clipboard.writeText` after setup rather than
// replacing the whole object (which userEvent would shadow).
function spyClipboard(impl: () => Promise<void> = () => Promise.resolve()) {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    })
  }
  return vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(impl)
}

describe('SettingsPage interaction — search', () => {
  it('narrows the command list to matching commands', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    // Search box is always rendered (the section is force-mounted).
    const searchBox = await screen.findByRole('textbox', { name: /search settings/i })

    // A command from a different label is present before searching.
    expect(screen.getByText('Create D1 database')).toBeInTheDocument()
    expect(screen.getByText('Deploy production')).toBeInTheDocument()

    await user.type(searchBox, 'deploy')

    await waitFor(() => {
      expect(screen.queryByText('Create D1 database')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Deploy production')).toBeInTheDocument()
  })

  it('shows a No matches empty state when nothing matches the search', async () => {
    const user = userEvent.setup()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const searchBox = await screen.findByRole('textbox', { name: /search settings/i })
    await user.type(searchBox, 'zzzznomatch')

    expect(await screen.findByText('No matches')).toBeInTheDocument()
  })
})

describe('SettingsPage interaction — batch copy commands', () => {
  it('hides the bulk bar when nothing is selected', async () => {
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    await screen.findByRole('textbox', { name: /search settings/i })
    expect(screen.queryByRole('button', { name: /copy commands/i })).not.toBeInTheDocument()
  })

  it('select-all then Copy commands writes joined commands and shows success toast', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    const writeText = spyClipboard()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    // Narrow to two known commands so the joined text is deterministic.
    const searchBox = await screen.findByRole('textbox', { name: /search settings/i })
    await user.type(searchBox, 'sequences')

    await waitFor(() => {
      expect(screen.getByText('Compile sequences')).toBeInTheDocument()
    })

    const selectAll = screen.getByRole('checkbox', { name: /select all commands/i })
    await user.click(selectAll)

    const copyBtn = await screen.findByRole('button', { name: /copy commands/i })
    await user.click(copyBtn)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('pnpm seq compile\npnpm seq sync --remote')
    })
    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Copied 2 commands')
    })
    // Selection cleared → bulk bar gone.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /copy commands/i })).not.toBeInTheDocument()
    })
  })

  it('copies a single selected command via its row checkbox', async () => {
    const user = userEvent.setup()
    const writeText = spyClipboard()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const searchBox = await screen.findByRole('textbox', { name: /search settings/i })
    await user.type(searchBox, 'Deploy production')

    const rowCheckbox = await screen.findByRole('checkbox', { name: /select deploy production/i })
    await user.click(rowCheckbox)

    const copyBtn = await screen.findByRole('button', { name: /copy commands/i })
    await user.click(copyBtn)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('pnpm deploy:prod')
    })
  })

  it('shows an error toast when the clipboard write fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    spyClipboard(() => Promise.reject(new Error('denied')))
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const searchBox = await screen.findByRole('textbox', { name: /search settings/i })
    await user.type(searchBox, 'Deploy production')

    const rowCheckbox = await screen.findByRole('checkbox', { name: /select deploy production/i })
    await user.click(rowCheckbox)

    const copyBtn = await screen.findByRole('button', { name: /copy commands/i })
    await user.click(copyBtn)

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('We could not copy these commands.')
    })
  })

  it('clears the selection without copying when Clear is pressed', async () => {
    const user = userEvent.setup()
    const writeText = spyClipboard()
    getProducts.mockResolvedValue([PRODUCT])
    getApiTokens.mockResolvedValue([])
    render(renderPage())

    const searchBox = await screen.findByRole('textbox', { name: /search settings/i })
    await user.type(searchBox, 'Deploy production')

    const rowCheckbox = await screen.findByRole('checkbox', { name: /select deploy production/i })
    await user.click(rowCheckbox)

    const clearBtn = await screen.findByRole('button', { name: /^clear$/i })
    await user.click(clearBtn)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /copy commands/i })).not.toBeInTheDocument()
    })
    expect(writeText).not.toHaveBeenCalled()
  })
})
