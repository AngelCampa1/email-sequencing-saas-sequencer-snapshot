import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input } from './input'

describe('Input', () => {
  it('includes focus-visible ring for keyboard accessibility', () => {
    const markup = renderToStaticMarkup(<Input />)
    expect(markup).toContain('focus-visible:ring-2')
    expect(markup).toContain('focus-visible:ring-blue-500')
  })

  it('does not include legacy focus: ring classes', () => {
    const markup = renderToStaticMarkup(<Input />)
    expect(markup).not.toContain('focus:ring-1')
    expect(markup).not.toContain('focus:outline-none')
  })
})
