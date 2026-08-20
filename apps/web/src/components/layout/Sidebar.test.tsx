import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'

function render() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  it('renders every primary destination', () => {
    const markup = render()
    for (const label of [
      'Overview',
      'Sequences',
      'Contacts',
      'Lead Magnets',
      'Block list',
      'Templates',
      'Deliverability',
      'Audit Log',
      'Products',
      'Settings',
    ]) {
      expect(markup).toContain(label)
    }
  })

  it('shows group labels only on desktop', () => {
    const markup = render()
    expect(markup).toContain('Email')
    expect(markup).toContain('Analytics')
    expect(markup).toContain('Platform')
    // The label paragraphs stay hidden until the md breakpoint.
    expect(markup).toContain('hidden px-3 mb-1')
  })

  it('wraps every link into one even strip on mobile and stacks on desktop', () => {
    const markup = render()
    // On mobile the nav is a wrapping flex so every link is visible and evenly
    // packed, with no item bleeding past the viewport edge. The group wrappers
    // dissolve (display:contents) so links become direct flex children.
    expect(markup).toContain('flex flex-wrap')
    expect(markup).toContain('contents md:block')
  })
})
