// @vitest-environment jsdom
import '../test/interaction-setup'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { auditActionLabel } from '../lib/labels'
import type { AuditEntry } from '../lib/types'
import { AuditPage, AuditRow } from './AuditPage'

vi.mock('../lib/api', () => ({
  getAuditLog: vi.fn(),
}))

const getAuditLog = vi.mocked(api.getAuditLog)

function makeEntry(index: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `audit_${index}`,
    actor: `user${index}@example.com`,
    action: 'updated',
    target_type: 'sequence',
    target_id: `seq_${index}abcdef12`,
    before: null,
    after: null,
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  }
}

function renderPage(): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <AuditPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AuditPage (interaction)', () => {
  it('shows a skeleton while data is loading', () => {
    getAuditLog.mockReturnValue(new Promise(() => {}))
    const { container } = render(renderPage())
    // TableSkeleton is rendered while loading; table is absent.
    expect(container.querySelector('[aria-label="Audit log entries"]')).toBeNull()
  })

  it('renders the page heading', async () => {
    getAuditLog.mockResolvedValue({ entries: [], has_next: false })
    render(renderPage())
    expect(await screen.findByText('Audit Log')).toBeInTheDocument()
  })

  it('shows empty state when entries array is empty', async () => {
    getAuditLog.mockResolvedValue({ entries: [], has_next: false })
    render(renderPage())
    expect(await screen.findByText('No audit entries yet')).toBeInTheDocument()
    expect(screen.getByText(/Changes will show up here as you make them/)).toBeInTheDocument()
  })

  it('renders audit entries in the table', async () => {
    const entry = makeEntry(1)
    getAuditLog.mockResolvedValue({ entries: [entry], has_next: false })
    render(renderPage())

    expect(await screen.findByText('user1@example.com')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.getByText('Sequence')).toBeInTheDocument()
    // target_id sliced to 8 chars: 'seq_1abc'
    expect(screen.getByText('#seq_1abc')).toBeInTheDocument()
  })

  it('renders target_id truncated to 8 chars with # prefix', async () => {
    const entry = makeEntry(2, { target_id: '1234567890abcdef' })
    getAuditLog.mockResolvedValue({ entries: [entry], has_next: false })
    render(renderPage())

    await screen.findByText('user2@example.com')
    expect(screen.getByText('#12345678')).toBeInTheDocument()
  })

  it('does not render target_id when target_id is null', async () => {
    const entry = makeEntry(3, { target_id: null })
    getAuditLog.mockResolvedValue({ entries: [entry], has_next: false })
    render(renderPage())

    await screen.findByText('user3@example.com')
    // No # prefix element
    expect(screen.queryByText(/^#/)).toBeNull()
  })

  it('shows error state and retry button on query failure', async () => {
    getAuditLog.mockRejectedValue(new Error('network failure'))
    render(renderPage())

    expect(await screen.findByText('Failed to load audit log')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('refetches when retry button is clicked', async () => {
    getAuditLog.mockRejectedValue(new Error('network failure'))
    render(renderPage())

    await screen.findByText('Failed to load audit log')
    const callsBefore = getAuditLog.mock.calls.length

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retryBtn)

    await waitFor(() => {
      expect(getAuditLog.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('Prev button is disabled on page 1', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())

    await screen.findByText('user1@example.com')
    const prev = screen.getByRole('button', { name: /prev/i })
    expect(prev).toBeDisabled()
  })

  it('Next button is disabled when has_next is false', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())

    await screen.findByText('user1@example.com')
    const next = screen.getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()
  })

  it('Next button is enabled when has_next is true', async () => {
    getAuditLog.mockResolvedValue({
      entries: Array.from({ length: 50 }, (_, i) => makeEntry(i + 1)),
      has_next: true,
    })
    render(renderPage())

    await screen.findByText('user1@example.com')
    const next = screen.getByRole('button', { name: /next/i })
    expect(next).not.toBeDisabled()
  })

  it('advances to page 2 when Next is clicked', async () => {
    getAuditLog
      .mockResolvedValueOnce({
        entries: Array.from({ length: 10 }, (_, i) => makeEntry(i + 1)),
        has_next: true,
      })
      .mockResolvedValueOnce({
        entries: [makeEntry(99, { actor: 'page2@example.com' })],
        has_next: false,
      })
    render(renderPage())

    await screen.findByText('user1@example.com')
    expect(screen.getByText('Page 1')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: /next/i })
    await userEvent.click(next)

    expect(await screen.findByText('Page 2')).toBeInTheDocument()
    expect(await screen.findByText('page2@example.com')).toBeInTheDocument()
  })

  it('goes back to page 1 from page 2 when Prev is clicked', async () => {
    getAuditLog
      .mockResolvedValueOnce({
        entries: [makeEntry(1)],
        has_next: true,
      })
      .mockResolvedValueOnce({
        entries: [makeEntry(99, { actor: 'page2@example.com' })],
        has_next: false,
      })
      .mockResolvedValue({
        entries: [makeEntry(1)],
        has_next: true,
      })

    render(renderPage())
    await screen.findByText('user1@example.com')

    // Go to page 2
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText('Page 2')).toBeInTheDocument()

    // Go back to page 1
    const prev = screen.getByRole('button', { name: /prev/i })
    await userEvent.click(prev)

    expect(await screen.findByText('Page 1')).toBeInTheDocument()
  })

  it('prev does not go below page 1 (Math.max guard)', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())

    await screen.findByText('user1@example.com')
    // Prev is disabled on page 1; clicking it should not change the page
    const prev = screen.getByRole('button', { name: /prev/i })
    expect(prev).toBeDisabled()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('calls getAuditLog with the object form (page) on first load', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())

    await screen.findByText('user1@example.com')
    expect(getAuditLog).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
  })
})

describe('AuditPage filters (interaction)', () => {
  it('typing in the actor filter calls getAuditLog with that actor (debounced)', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())
    await screen.findByText('user1@example.com')

    const input = screen.getByLabelText('Filter by who made the change')
    await userEvent.type(input, 'system')

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actor: 'system' }))
    })
  })

  it('selecting an action filter calls getAuditLog with that action', async () => {
    getAuditLog.mockResolvedValue({
      entries: [makeEntry(1, { action: 'suppression.removed' })],
      has_next: false,
    })
    render(renderPage())
    await screen.findByText('user1@example.com')

    const select = screen.getByLabelText('Filter by action')
    select.focus()
    // Radix Select opens on Enter/Space and exposes options with role="option".
    await userEvent.keyboard('{Enter}')
    const option = await screen.findByRole('option', {
      name: auditActionLabel('suppression.removed'),
    })
    await userEvent.click(option)

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'suppression.removed' }),
      )
    })
  })

  it('setting from/to calls getAuditLog with those bounds', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())
    await screen.findByText('user1@example.com')

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-01-01' },
    })
    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-02-01' },
    })

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-01-01', to: '2026-02-01' }),
      )
    })
  })

  it('Clear filters appears when a filter is set and resets to no-filter calls', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())
    await screen.findByText('user1@example.com')

    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-01-01' },
    })

    const clear = await screen.findByRole('button', { name: /clear filters/i })
    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-01-01' }))
    })

    await userEvent.click(clear)

    await waitFor(() => {
      const last = getAuditLog.mock.calls.at(-1)?.[0]
      expect(last).toEqual(expect.objectContaining({ from: undefined, page: 1 }))
    })
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()
  })

  it('changing a filter resets the page back to 1', async () => {
    getAuditLog
      .mockResolvedValueOnce({
        entries: Array.from({ length: 10 }, (_, i) => makeEntry(i + 1)),
        has_next: true,
      })
      .mockResolvedValue({
        entries: [makeEntry(1)],
        has_next: false,
      })
    render(renderPage())
    await screen.findByText('user1@example.com')
    expect(screen.getByText('Page 1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText('Page 2')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-03-01' },
    })

    await waitFor(() => {
      const last = getAuditLog.mock.calls.at(-1)?.[0]
      expect(last).toEqual(expect.objectContaining({ page: 1, from: '2026-03-01' }))
    })
    expect(await screen.findByText('Page 1')).toBeInTheDocument()
  })

  it('shows a distinct empty state when filters are active and no entries', async () => {
    getAuditLog.mockResolvedValue({ entries: [], has_next: false })
    render(renderPage())
    // No filters yet -> default empty state
    expect(await screen.findByText('No audit entries yet')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-01-01' },
    })

    expect(await screen.findByText('No matching entries')).toBeInTheDocument()
    expect(screen.getByText('Try clearing a filter or widening the dates.')).toBeInTheDocument()
  })

  it('renders an enabled Export CSV button when rows are present', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())
    await screen.findByText('user1@example.com')

    const exportBtn = screen.getByRole('button', { name: /export csv/i })
    expect(exportBtn).toBeInTheDocument()
    expect(exportBtn).not.toBeDisabled()
  })

  it('exports the current page rows to CSV when Export is clicked', async () => {
    getAuditLog.mockResolvedValue({
      entries: [makeEntry(1, { target_id: null }), makeEntry(2)],
      has_next: false,
    })
    const createObjectURL = vi.fn(() => 'blob:mock')
    const origCreate = globalThis.URL.createObjectURL
    globalThis.URL.createObjectURL = createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.revokeObjectURL = vi.fn()

    render(renderPage())
    await screen.findByText('user1@example.com')

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

    // The CSV accessors run (including the null target_id path) and a blob is created.
    expect(createObjectURL).toHaveBeenCalled()

    globalThis.URL.createObjectURL = origCreate
    globalThis.URL.revokeObjectURL = origRevoke
  })

  it('Clear filters clears a pending debounced actor timer', async () => {
    getAuditLog.mockResolvedValue({ entries: [makeEntry(1)], has_next: false })
    render(renderPage())
    await screen.findByText('user1@example.com')

    // Type to start a pending 300ms timer, then immediately set another filter so
    // Clear filters is visible, then clear before the actor timer fires.
    const actorInput = screen.getByLabelText('Filter by who made the change')
    await userEvent.type(actorInput, 'system')

    const clear = await screen.findByRole('button', { name: /clear filters/i })
    await userEvent.click(clear)

    // Actor input is reset and the pending timer was cleared (no late actor call).
    expect(actorInput).toHaveValue('')
    await waitFor(() => {
      const last = getAuditLog.mock.calls.at(-1)?.[0]
      expect(last).toEqual(expect.objectContaining({ actor: undefined }))
    })
  })
})

describe('AuditRow (interaction)', () => {
  function renderRow(entry: AuditEntry) {
    return render(
      <table>
        <tbody>
          <AuditRow entry={entry} />
        </tbody>
      </table>,
    )
  }

  it('does not render expand button when entry has no changes', () => {
    const entry = makeEntry(1, { before: null, after: null })
    renderRow(entry)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders expand button when entry has before snapshot', () => {
    const entry = makeEntry(1, { before: { active: false }, after: null })
    renderRow(entry)
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders expand button when entry has after snapshot', () => {
    const entry = makeEntry(1, { before: null, after: { active: true } })
    renderRow(entry)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('shows "Show changes" aria-label when collapsed', () => {
    const entry = makeEntry(5, { before: { x: 1 }, after: { x: 2 } })
    renderRow(entry)
    expect(
      screen.getByRole('button', { name: /Show changes for audit entry audit_5/i }),
    ).toBeInTheDocument()
  })

  it('expands to show before/after panels when expand button is clicked', async () => {
    const entry = makeEntry(1, {
      before: { active: false },
      after: { active: true },
    })
    renderRow(entry)

    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(btn)

    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hide changes/i })).toBeInTheDocument()
  })

  it('collapses expanded row when button is clicked again', async () => {
    const entry = makeEntry(1, { before: { x: 1 }, after: { x: 2 } })
    renderRow(entry)

    const btn = screen.getByRole('button')
    await userEvent.click(btn)
    expect(screen.getByText('Before')).toBeInTheDocument()

    await userEvent.click(btn)
    expect(screen.queryByText('Before')).toBeNull()
    expect(screen.queryByText('After')).toBeNull()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows only Before panel when after is null', async () => {
    const entry = makeEntry(1, { before: { x: 1 }, after: null })
    renderRow(entry)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.queryByText('After')).toBeNull()
  })

  it('shows only After panel when before is null', async () => {
    const entry = makeEntry(1, { before: null, after: { x: 2 } })
    renderRow(entry)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.queryByText('Before')).toBeNull()
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  it('shows both Before and After panels when both are present', async () => {
    const entry = makeEntry(1, { before: { x: 1 }, after: { x: 2 } })
    renderRow(entry)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  it('JSON-stringifies the before/after snapshots in the expanded panel', async () => {
    const entry = makeEntry(1, {
      before: { status: 'inactive' },
      after: { status: 'active' },
    })
    renderRow(entry)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText(/"status": "inactive"/)).toBeInTheDocument()
    expect(screen.getByText(/"status": "active"/)).toBeInTheDocument()
  })

  it('clicking on a row without changes (hasChanges=false) does nothing', async () => {
    const entry = makeEntry(1, { before: null, after: null })
    renderRow(entry)
    // No button rendered — interaction is no-op; just verify row still renders
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('user1@example.com')).toBeInTheDocument()
  })
})
