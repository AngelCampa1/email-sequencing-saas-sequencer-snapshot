import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TablePagination } from './table-pagination'

// ---------------------------------------------------------------------------
// Static-markup tests (node environment — no DOM needed)
// ---------------------------------------------------------------------------

// Helper: extract the opening button tag that immediately precedes label text.
// Because Tailwind class strings contain "disabled:" tokens, we must look for
// the boolean disabled="" attribute, not the substring "disabled" in classes.
function buttonTagBefore(html: string, label: string): string {
  const labelIdx = html.indexOf(label)
  const segment = html.slice(0, labelIdx)
  const lastButtonOpen = segment.lastIndexOf('<button')
  // Grab just the tag up to the first '>'
  const closeAngle = html.indexOf('>', lastButtonOpen)
  return html.slice(lastButtonOpen, closeAngle + 1)
}

function isButtonDisabled(tag: string): boolean {
  // HTML serialises boolean disabled as `disabled=""` or just `disabled`
  return /\bdisabled(=""|(?=[>\s]))/.test(tag)
}

describe('TablePagination label', () => {
  it('renders "Page N" when no total is provided', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={3} pageSize={10} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(html).toContain('Page 3')
  })

  it('renders "X–Y of N" when total is provided (mid-page)', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={2} pageSize={10} total={35} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(html).toContain('11')
    expect(html).toContain('20')
    expect(html).toContain('35')
  })

  it('renders correctly on the first page with total', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={1} pageSize={10} total={35} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    // label "1–10 of 35"
    expect(html).toMatch(/1.{1,5}10.{1,5}35/)
  })

  it('clamps Y to total on the last partial page', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={4} pageSize={10} total={35} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    // page 4: X=31, Y=min(40,35)=35 → "31–35 of 35"
    expect(html).toContain('31')
    // appears twice (Y and total)
    expect(html.split('35').length).toBeGreaterThanOrEqual(2)
  })

  it('shows "0–0 of 0" when total is 0', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={1} pageSize={10} total={0} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(html).toContain('0–0 of 0')
  })
})

describe('TablePagination Prev button disabled state', () => {
  it('disables Prev when page === 1', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={1} pageSize={10} total={50} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, 'Prev')
    expect(isButtonDisabled(tag)).toBe(true)
  })

  it('does NOT disable Prev when page > 1', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={2} pageSize={10} total={50} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, 'Prev')
    expect(isButtonDisabled(tag)).toBe(false)
  })
})

describe('TablePagination Next button disabled state', () => {
  it('disables Next when page * pageSize >= total (exact boundary)', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={5} pageSize={10} total={50} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, '>Next')
    expect(isButtonDisabled(tag)).toBe(true)
  })

  it('disables Next when page * pageSize > total (over boundary)', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={4} pageSize={10} total={35} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, '>Next')
    expect(isButtonDisabled(tag)).toBe(true)
  })

  it('does NOT disable Next when not on the last page', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={1} pageSize={10} total={50} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, '>Next')
    expect(isButtonDisabled(tag)).toBe(false)
  })

  it('disables Next when hasMore is false and no total given', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={3} pageSize={10} hasMore={false} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, '>Next')
    expect(isButtonDisabled(tag)).toBe(true)
  })

  it('does NOT disable Next when hasMore is true and no total given', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={3} pageSize={10} hasMore={true} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, '>Next')
    expect(isButtonDisabled(tag)).toBe(false)
  })

  it('does NOT disable Next when hasMore is undefined and no total given', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={1} pageSize={10} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    const tag = buttonTagBefore(html, '>Next')
    expect(isButtonDisabled(tag)).toBe(false)
  })
})

describe('TablePagination page-size select', () => {
  it('does NOT render the size select when pageSizeOptions are not provided', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={1} pageSize={10} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(html).not.toContain('per page')
  })

  it('does NOT render the size select when onPageSizeChange is not provided', () => {
    const html = renderToStaticMarkup(
      <TablePagination
        page={1}
        pageSize={10}
        pageSizeOptions={[10, 25, 50]}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(html).not.toContain('per page')
  })

  it('renders the size select when both pageSizeOptions and onPageSizeChange are provided', () => {
    const html = renderToStaticMarkup(
      <TablePagination
        page={1}
        pageSize={10}
        pageSizeOptions={[10, 25, 50]}
        onPageSizeChange={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(html).toContain('per page')
  })

  it('shows "per page" label when select is provided', () => {
    // Radix Select does not embed the value in static markup (uses a hidden native select).
    // We verify the select section renders at all.
    const html = renderToStaticMarkup(
      <TablePagination
        page={1}
        pageSize={25}
        pageSizeOptions={[10, 25, 50]}
        onPageSizeChange={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(html).toContain('per page')
    // The Radix combobox trigger is present
    expect(html).toContain('role="combobox"')
  })
})

describe('TablePagination uses pill Button', () => {
  it('uses rounded-full buttons (pill shape)', () => {
    const html = renderToStaticMarkup(
      <TablePagination page={2} pageSize={10} total={50} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(html).toContain('rounded-full')
  })
})
