// Static (node) assertions first — no jsdom needed for renderToStaticMarkup
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BulkActionBar, RowCheckbox, SelectAllCheckbox } from './row-select'

// ---------------------------------------------------------------------------
// RowCheckbox — static markup assertions
// ---------------------------------------------------------------------------
describe('RowCheckbox (static)', () => {
  it('renders a checkbox input', () => {
    const html = renderToStaticMarkup(
      <RowCheckbox checked={false} onChange={() => {}} aria-label="Select row" />,
    )
    expect(html).toContain('type="checkbox"')
  })

  it('renders checked attribute when checked=true', () => {
    const html = renderToStaticMarkup(
      <RowCheckbox checked={true} onChange={() => {}} aria-label="Select row" />,
    )
    expect(html).toContain('checked')
  })

  it('forwards aria-label', () => {
    const html = renderToStaticMarkup(
      <RowCheckbox checked={false} onChange={() => {}} aria-label="Select item 42" />,
    )
    expect(html).toContain('aria-label="Select item 42"')
  })

  it('renders without aria-label when not provided', () => {
    const html = renderToStaticMarkup(<RowCheckbox checked={false} onChange={() => {}} />)
    expect(html).toContain('type="checkbox"')
  })
})

// ---------------------------------------------------------------------------
// SelectAllCheckbox — static markup assertions
// ---------------------------------------------------------------------------
describe('SelectAllCheckbox (static)', () => {
  it('renders a checkbox input', () => {
    const html = renderToStaticMarkup(
      <SelectAllCheckbox checked={false} indeterminate={false} onChange={() => {}} />,
    )
    expect(html).toContain('type="checkbox"')
  })

  it('forwards aria-label', () => {
    const html = renderToStaticMarkup(
      <SelectAllCheckbox
        checked={false}
        indeterminate={false}
        onChange={() => {}}
        aria-label="Select all"
      />,
    )
    expect(html).toContain('aria-label="Select all"')
  })

  it('renders checked attribute when checked=true', () => {
    const html = renderToStaticMarkup(
      <SelectAllCheckbox checked={true} indeterminate={false} onChange={() => {}} />,
    )
    expect(html).toContain('checked')
  })

  it('forwards id so a visible <label htmlFor> can target the input', () => {
    const html = renderToStaticMarkup(
      <SelectAllCheckbox
        id="select-all-commands"
        checked={false}
        indeterminate={false}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('id="select-all-commands"')
  })

  it('omits the id attribute when no id is given', () => {
    const html = renderToStaticMarkup(
      <SelectAllCheckbox checked={false} indeterminate={false} onChange={() => {}} />,
    )
    expect(html).not.toContain('id=')
  })
})

// ---------------------------------------------------------------------------
// BulkActionBar — static markup assertions
// ---------------------------------------------------------------------------
describe('BulkActionBar (static)', () => {
  it('returns null when count is 0', () => {
    const html = renderToStaticMarkup(
      <BulkActionBar count={0} onClear={() => {}}>
        <button>Delete</button>
      </BulkActionBar>,
    )
    expect(html).toBe('')
  })

  it('renders "{count} selected" when count > 0', () => {
    const html = renderToStaticMarkup(
      <BulkActionBar count={3} onClear={() => {}}>
        <button>Delete</button>
      </BulkActionBar>,
    )
    expect(html).toContain('3 selected')
  })

  it('renders children when count > 0', () => {
    const html = renderToStaticMarkup(
      <BulkActionBar count={1} onClear={() => {}}>
        <button>Archive</button>
      </BulkActionBar>,
    )
    expect(html).toContain('Archive')
  })

  it('renders a Clear button when count > 0', () => {
    const html = renderToStaticMarkup(
      <BulkActionBar count={2} onClear={() => {}}>
        <button>Do something</button>
      </BulkActionBar>,
    )
    expect(html).toContain('Clear')
  })

  it('the bulk bar is pill-shaped (rounded-full)', () => {
    const html = renderToStaticMarkup(
      <BulkActionBar count={1} onClear={() => {}}>
        <button>X</button>
      </BulkActionBar>,
    )
    expect(html).toContain('rounded-full')
  })
})

// ---------------------------------------------------------------------------
// jsdom interaction tests — per-file opt-in
// ---------------------------------------------------------------------------
// @vitest-environment jsdom
// NOTE: We cannot mix environments in a single file. The jsdom interaction
// tests live in row-select.interaction.test.tsx so they can use the
// @vitest-environment jsdom docblock.
