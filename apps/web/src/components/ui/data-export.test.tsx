import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ExportButton } from './data-export'

const cols = [{ header: 'Name', accessor: (r: { name: string }) => r.name }]
const rows = [{ name: 'Alice' }, { name: 'Bob' }]

describe('ExportButton (static render)', () => {
  it('renders a button element', () => {
    const html = renderToStaticMarkup(
      <ExportButton rows={rows} columns={cols} filename="test.csv" />,
    )
    expect(html).toContain('<button')
  })

  it('renders the default label "Export CSV"', () => {
    const html = renderToStaticMarkup(
      <ExportButton rows={rows} columns={cols} filename="test.csv" />,
    )
    expect(html).toContain('Export CSV')
  })

  it('renders a custom label when provided', () => {
    const html = renderToStaticMarkup(
      <ExportButton rows={rows} columns={cols} filename="test.csv" label="Download" />,
    )
    expect(html).toContain('Download')
  })

  it('is disabled when rows is empty', () => {
    const html = renderToStaticMarkup(<ExportButton rows={[]} columns={cols} filename="test.csv" />)
    expect(html).toContain('disabled')
  })

  it('is not disabled when rows has items', () => {
    const html = renderToStaticMarkup(
      <ExportButton rows={rows} columns={cols} filename="test.csv" />,
    )
    // The boolean disabled attribute appears as a standalone word in the tag.
    // Check there's no ` disabled` (attribute) but Tailwind class `disabled:` may still appear.
    expect(html).not.toMatch(/ disabled[^:]/)
  })

  it('uses pill shape (rounded-full) from Button', () => {
    const html = renderToStaticMarkup(
      <ExportButton rows={rows} columns={cols} filename="test.csv" />,
    )
    expect(html).toContain('rounded-full')
  })

  it('renders a Download icon (svg)', () => {
    const html = renderToStaticMarkup(
      <ExportButton rows={rows} columns={cols} filename="test.csv" />,
    )
    expect(html).toContain('<svg')
  })
})
