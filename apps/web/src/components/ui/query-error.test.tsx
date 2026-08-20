import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QueryError } from './query-error'

describe('QueryError', () => {
  it('renders an alert with the formatted error message', () => {
    const markup = renderToStaticMarkup(
      <QueryError title="Failed to load contacts" error={new Error('API unavailable')} />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Failed to load contacts')
    expect(markup).toContain('API unavailable')
  })

  it('renders a retry button when retry is available', () => {
    const markup = renderToStaticMarkup(
      <QueryError title="Failed" error={new Error('Nope')} onRetry={() => undefined} />,
    )

    expect(markup).toContain('<button')
    expect(markup).toContain('Retry')
  })

  it('disables the retry button while retrying', () => {
    const markup = renderToStaticMarkup(
      <QueryError title="Failed" error={new Error('Nope')} onRetry={() => undefined} isRetrying />,
    )

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Retrying')
    expect(markup).toContain('animate-spin')
  })
})
