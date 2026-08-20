import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SortableHeader } from './sortable-header'

describe('SortableHeader: aria-sort', () => {
  it('sets aria-sort="ascending" when this field is the active asc sort', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={{ key: 'name', direction: 'asc' }} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('aria-sort="ascending"')
  })

  it('sets aria-sort="descending" when this field is the active desc sort', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={{ key: 'name', direction: 'desc' }} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('aria-sort="descending"')
  })

  it('sets aria-sort="none" when sort is null', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={null} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('aria-sort="none"')
  })

  it('sets aria-sort="none" when a different field is sorted', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={{ key: 'email', direction: 'asc' }} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('aria-sort="none"')
  })
})

describe('SortableHeader: chevron indicator', () => {
  it('shows ChevronUp when active asc', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={{ key: 'name', direction: 'asc' }} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    // ChevronUp SVG path differs from ChevronDown
    expect(html).toContain('chevron-up')
  })

  it('shows ChevronDown when active desc', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={{ key: 'name', direction: 'desc' }} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('chevron-down')
  })

  it('shows ChevronsUpDown (neutral) when not active', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={null} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('chevrons-up-down')
  })

  it('shows ChevronsUpDown when a different field is active', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={{ key: 'other', direction: 'asc' }} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('chevrons-up-down')
  })
})

describe('SortableHeader: structure', () => {
  it('renders a <th> as the root element', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={null} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html.startsWith('<th')).toBe(true)
  })

  it('renders a button with type="button" inside the th', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={null} onToggle={() => {}}>
        Name
      </SortableHeader>,
    )
    expect(html).toContain('type="button"')
  })

  it('renders children inside the button', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={null} onToggle={() => {}}>
        My Column
      </SortableHeader>,
    )
    expect(html).toContain('My Column')
  })

  it('applies extra className to the th', () => {
    const html = renderToStaticMarkup(
      <SortableHeader field="name" sort={null} onToggle={() => {}} className="w-32">
        Name
      </SortableHeader>,
    )
    expect(html).toContain('w-32')
  })
})
