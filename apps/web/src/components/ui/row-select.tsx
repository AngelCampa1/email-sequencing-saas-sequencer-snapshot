/**
 * Row selection + bulk action UI primitives.
 *
 * - RowCheckbox: accessible checkbox for a single data row.
 * - SelectAllCheckbox: checkbox that supports the indeterminate (half-filled)
 *   state used by "select all" headers. The `indeterminate` DOM property is
 *   set imperatively via ref+useEffect because HTML has no attribute for it.
 * - BulkActionBar: sticky bottom bar shown when count>0; renders "{count}
 *   selected", a pill Clear button, and caller-supplied action children.
 *
 * Styling tokens match apps/web/src/components/ui/select.tsx:
 *   border-slate-300, text-slate-700, bg-white, rounded-md, focus-visible ring,
 *   text-sm, shadow-md.
 */

import { type ChangeEventHandler, type ReactNode, useEffect, useRef } from 'react'
import { Button } from './button'

// ---------------------------------------------------------------------------
// RowCheckbox
// ---------------------------------------------------------------------------

interface RowCheckboxProps {
  checked: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
  'aria-label'?: string
}

export function RowCheckbox({ checked, onChange, 'aria-label': ariaLabel }: RowCheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-4 w-4 cursor-pointer rounded border border-slate-300 text-slate-700 accent-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    />
  )
}

// ---------------------------------------------------------------------------
// SelectAllCheckbox
// ---------------------------------------------------------------------------

interface SelectAllCheckboxProps {
  checked: boolean
  indeterminate: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
  'aria-label'?: string
  /** Set when a visible <label htmlFor> needs to point at this input. */
  id?: string
}

export function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  'aria-label': ariaLabel,
  id,
}: SelectAllCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-4 w-4 cursor-pointer rounded border border-slate-300 text-slate-700 accent-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    />
  )
}

// ---------------------------------------------------------------------------
// BulkActionBar
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  count: number
  onClear: () => void
  children: ReactNode
}

export function BulkActionBar({ count, onClear, children }: BulkActionBarProps) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-md">
      <span className="text-sm font-medium text-slate-700">{count} selected</span>
      <Button variant="secondary" size="sm" onClick={onClear}>
        Clear
      </Button>
      {children}
    </div>
  )
}
