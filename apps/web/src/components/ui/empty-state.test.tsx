import { Inbox } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state'

describe('EmptyState', () => {
  it('renders the icon, title, and description', () => {
    const markup = renderToStaticMarkup(
      <EmptyState icon={Inbox} title="No audit entries yet" description="Changes show up here." />,
    )
    expect(markup).toContain('No audit entries yet')
    expect(markup).toContain('Changes show up here.')
    // lucide renders an svg
    expect(markup).toContain('<svg')
  })

  it('omits the description paragraph when none is given', () => {
    const markup = renderToStaticMarkup(<EmptyState icon={Inbox} title="Nothing here" />)
    expect(markup).toContain('Nothing here')
    // only the title paragraph, no second muted line
    expect(markup).not.toContain('text-xs text-slate-500 mt-1')
  })

  it('merges an extra className onto the container', () => {
    const markup = renderToStaticMarkup(
      <EmptyState icon={Inbox} title="Nothing" className="custom-pad" />,
    )
    expect(markup).toContain('custom-pad')
    expect(markup).toContain('px-5 py-12 text-center')
  })
})
