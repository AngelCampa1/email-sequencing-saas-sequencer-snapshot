// @vitest-environment jsdom
import '../../test/interaction-setup'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from './copy-button'

function setClipboard(value: { writeText: ReturnType<typeof vi.fn> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })
}

describe('CopyButton', () => {
  beforeEach(() => {
    vi.useRealTimers()
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the given label as the accessible name', () => {
    render(<CopyButton value="abc-123" label="Copy reference" />)
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeInTheDocument()
  })

  it('writes the value to the clipboard on click', () => {
    render(<CopyButton value="abc-123" label="Copy reference" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc-123')
  })

  it('switches to a "Copied" state after a successful copy', async () => {
    render(<CopyButton value="abc-123" label="Copy reference" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })
  })

  it('stays usable when the clipboard API is unavailable', () => {
    setClipboard(undefined)
    render(<CopyButton value="abc-123" label="Copy reference" />)

    // Should not throw when clicked without a clipboard API, and stays in the
    // idle state since nothing was copied.
    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }))
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeInTheDocument()
  })

  it('stays in the idle state when the clipboard write is rejected', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('permission denied')) })
    render(<CopyButton value="abc-123" label="Copy reference" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }))

    // The rejection is swallowed (catch -> return), so it never flips to "Copied".
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc-123')
    })
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeInTheDocument()
  })

  it('resets the pending reset timer when copied again before it elapses', async () => {
    render(<CopyButton value="abc-123" label="Copy reference" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })

    // A second copy while still in the "Copied" window clears the first timer
    // before scheduling a fresh one.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copied' }))
    })
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('clears the pending reset timer on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(<CopyButton value="abc-123" label="Copy reference" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })

    act(() => {
      unmount()
    })
    expect(clearSpy).toHaveBeenCalled()
  })
})
