import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * React 19 SSR re-throws errors even when an error boundary is present,
 * so we cannot rely on renderToStaticMarkup to trigger boundary fallback.
 * Instead, we test the boundary in its triggered state by constructing
 * an instance and setting the error state directly, then render the
 * instance's output via a wrapper component.
 */
function ErrorFallbackRenderer({ message }: { message: string }) {
  // Mirror getDerivedStateFromError result and call render() via a wrapper
  const boundary = new ErrorBoundary({ children: null })
  boundary.state = { hasError: true, message }
  return boundary.render() as React.ReactElement
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    const markup = renderToStaticMarkup(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    )

    expect(markup).toContain('All good')
    expect(markup).not.toContain('Something went wrong')
  })

  it('renders the fallback heading when an error is triggered', () => {
    const markup = renderToStaticMarkup(
      <ErrorFallbackRenderer message="Intentional render error" />,
    )

    expect(markup).toContain('Something went wrong')
  })

  it('shows the error message in the fallback', () => {
    const markup = renderToStaticMarkup(
      <ErrorFallbackRenderer message="Intentional render error" />,
    )

    expect(markup).toContain('Intentional render error')
  })

  it('renders a Reload button in the fallback', () => {
    const markup = renderToStaticMarkup(
      <ErrorFallbackRenderer message="Intentional render error" />,
    )

    expect(markup).toContain('<button')
    expect(markup).toContain('Reload')
  })

  it('gives the Reload button a visible keyboard focus ring', () => {
    const markup = renderToStaticMarkup(
      <ErrorFallbackRenderer message="Intentional render error" />,
    )

    // Keyboard users must be able to see which control has focus.
    expect(markup).toContain('focus-visible:outline')
  })
})
