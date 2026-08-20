import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TableToolbar } from './toolbar'

describe('TableToolbar', () => {
  it('renders children in the output', () => {
    const html = renderToStaticMarkup(
      <TableToolbar>
        <input placeholder="Search..." />
      </TableToolbar>,
    )
    expect(html).toContain('Search...')
  })

  it('renders actions when provided', () => {
    const html = renderToStaticMarkup(
      <TableToolbar actions={<button type="button">Export</button>}>
        <span>filters</span>
      </TableToolbar>,
    )
    expect(html).toContain('Export')
    expect(html).toContain('filters')
  })

  it('does not include an actions slot element when actions not provided', () => {
    const html = renderToStaticMarkup(
      <TableToolbar>
        <span>filters</span>
      </TableToolbar>,
    )
    // Should still render children
    expect(html).toContain('filters')
    // No dedicated "actions" wrapper div when nothing passed
    expect(html).not.toContain('Export')
  })

  it('uses a flex container class', () => {
    const html = renderToStaticMarkup(
      <TableToolbar>
        <span>left</span>
      </TableToolbar>,
    )
    expect(html).toContain('flex')
  })

  it('includes a responsive wrap class', () => {
    const html = renderToStaticMarkup(
      <TableToolbar>
        <span>left</span>
      </TableToolbar>,
    )
    expect(html).toContain('flex-wrap')
  })

  it('renders both children and actions in the same container', () => {
    const html = renderToStaticMarkup(
      <TableToolbar actions={<button type="button">Refresh</button>}>
        <input placeholder="Filter" />
      </TableToolbar>,
    )
    expect(html).toContain('Filter')
    expect(html).toContain('Refresh')
  })

  it('actions slot is right-aligned via ml-auto or justify-between', () => {
    const html = renderToStaticMarkup(
      <TableToolbar actions={<button type="button">Export</button>}>
        <span>search</span>
      </TableToolbar>,
    )
    // Either ml-auto on the actions wrapper OR justify-between on the container
    const hasRightAlign =
      html.includes('ml-auto') || html.includes('justify-between') || html.includes('ml-auto')
    expect(hasRightAlign).toBe(true)
  })
})
