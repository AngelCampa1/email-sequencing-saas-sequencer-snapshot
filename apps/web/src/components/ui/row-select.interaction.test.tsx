// @vitest-environment jsdom
import '../../test/interaction-setup'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BulkActionBar, RowCheckbox, SelectAllCheckbox } from './row-select'

// ---------------------------------------------------------------------------
// RowCheckbox — onChange fires on click
// ---------------------------------------------------------------------------
describe('RowCheckbox (interaction)', () => {
  it('calls onChange when clicked', () => {
    const handleChange = vi.fn()
    const { getByRole } = render(
      <RowCheckbox checked={false} onChange={handleChange} aria-label="Select row" />,
    )
    const checkbox = getByRole('checkbox', { name: 'Select row' })
    fireEvent.click(checkbox)
    expect(handleChange).toHaveBeenCalledTimes(1)
  })

  it('reflects checked=true state on DOM input', () => {
    const { getByRole } = render(
      <RowCheckbox checked={true} onChange={() => {}} aria-label="Row A" />,
    )
    const input = getByRole('checkbox') as HTMLInputElement
    expect(input.checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SelectAllCheckbox — indeterminate DOM property + onChange
// ---------------------------------------------------------------------------
describe('SelectAllCheckbox (interaction)', () => {
  it('sets input.indeterminate=true on the DOM element when indeterminate=true', () => {
    const { getByRole } = render(
      <SelectAllCheckbox
        checked={false}
        indeterminate={true}
        onChange={() => {}}
        aria-label="Select all"
      />,
    )
    const input = getByRole('checkbox') as HTMLInputElement
    expect(input.indeterminate).toBe(true)
  })

  it('sets input.indeterminate=false when indeterminate=false', () => {
    const { getByRole } = render(
      <SelectAllCheckbox
        checked={true}
        indeterminate={false}
        onChange={() => {}}
        aria-label="Select all"
      />,
    )
    const input = getByRole('checkbox') as HTMLInputElement
    expect(input.indeterminate).toBe(false)
  })

  it('calls onChange when clicked', () => {
    const handleChange = vi.fn()
    const { getByRole } = render(
      <SelectAllCheckbox
        checked={false}
        indeterminate={false}
        onChange={handleChange}
        aria-label="Select all rows"
      />,
    )
    const checkbox = getByRole('checkbox', { name: 'Select all rows' })
    fireEvent.click(checkbox)
    expect(handleChange).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// BulkActionBar — onClear fires, children render
// ---------------------------------------------------------------------------
describe('BulkActionBar (interaction)', () => {
  it('calls onClear when the Clear button is clicked', () => {
    const handleClear = vi.fn()
    const { getByRole } = render(
      <BulkActionBar count={2} onClear={handleClear}>
        <button>Delete</button>
      </BulkActionBar>,
    )
    const clearBtn = getByRole('button', { name: 'Clear' })
    fireEvent.click(clearBtn)
    expect(handleClear).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when count=0', () => {
    const { container } = render(
      <BulkActionBar count={0} onClear={() => {}}>
        <button>Delete</button>
      </BulkActionBar>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders children action buttons when count > 0', () => {
    const { getByRole } = render(
      <BulkActionBar count={5} onClear={() => {}}>
        <button>Pause</button>
      </BulkActionBar>,
    )
    expect(getByRole('button', { name: 'Pause' })).toBeTruthy()
  })
})
