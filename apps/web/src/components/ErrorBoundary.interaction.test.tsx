// @vitest-environment jsdom
import '../test/interaction-setup'

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

// Suppress React's console.error noise from intentional throws in tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render error')
  }
  return <span>child content</span>
}

function ThrowingChildNoMessage({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw 'non-error throw'
  }
  return <span>child content</span>
}

describe('ErrorBoundary (interaction)', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })

  it('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test render error')).toBeInTheDocument()
  })

  it('renders Reload button in fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )
    const btn = screen.getByRole('button', { name: /reload/i })
    expect(btn).toBeInTheDocument()
  })

  it('calls componentDidCatch when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )
    // componentDidCatch calls console.error; verify it was invoked
    expect(console.error).toHaveBeenCalled()
  })

  it('getDerivedStateFromError uses fallback message for non-Error throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChildNoMessage shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument()
  })

  it('Reload button calls window.location.reload', () => {
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
      configurable: true,
    })

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    const btn = screen.getByRole('button', { name: /reload/i })
    btn.click()
    expect(reloadMock).toHaveBeenCalledTimes(1)
  })
})
