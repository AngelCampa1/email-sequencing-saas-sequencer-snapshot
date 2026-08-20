import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Spinner } from './spinner'

describe('Spinner', () => {
  it('renders a spinning indicator with the default accessible label', () => {
    const html = renderToStaticMarkup(<Spinner />)
    expect(html).toContain('animate-spin')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading"')
  })

  it('merges an extra className', () => {
    const html = renderToStaticMarkup(<Spinner className="text-white" />)
    expect(html).toContain('text-white')
    expect(html).toContain('animate-spin')
  })

  it('uses a custom accessible label', () => {
    const html = renderToStaticMarkup(<Spinner label="Saving" />)
    expect(html).toContain('aria-label="Saving"')
  })

  it('applies a custom size', () => {
    const html = renderToStaticMarkup(<Spinner size={24} />)
    expect(html).toContain('width="24"')
    expect(html).toContain('height="24"')
  })
})
