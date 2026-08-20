/**
 * useRowSelection — reusable row-selection + bulk-action primitive.
 *
 * Pruning strategy: INTERSECT ON READ.
 * The raw `selected` Set is never mutated in response to `allIds` changes.
 * All derived values (`count`, `allSelected`, `someSelected`) and `isSelected`
 * intersect with the current `allIds` array so stale ids are silently dropped
 * from counts without any useEffect or storage mutation. This is simpler and
 * correct for the common case where `allIds` changes due to filtering.
 */

import { useCallback, useMemo, useState } from 'react'

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

export interface SelectionState {
  count: number
  allSelected: boolean
  someSelected: boolean
}

/**
 * Compute derived selection state by intersecting `selected` with `allIds`.
 * Stale ids (present in `selected` but absent from `allIds`) are ignored.
 */
export function computeSelectionState<Id extends string>(
  allIds: Id[],
  selected: Set<Id>,
): SelectionState {
  if (allIds.length === 0) {
    return { count: 0, allSelected: false, someSelected: false }
  }

  let count = 0
  for (const id of allIds) {
    if (selected.has(id)) count++
  }

  const allSelected = count === allIds.length
  const someSelected = count > 0 && !allSelected

  return { count, allSelected, someSelected }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RowSelectionReturn<Id extends string> {
  /** Raw selected Set (may contain stale ids if allIds shrank). */
  selected: Set<Id>
  /** Returns true if `id` is selected AND present in the current allIds. */
  isSelected: (id: Id) => boolean
  /** Toggle a single id. Produces a new Set (immutable). */
  toggle: (id: Id) => void
  /**
   * If every id in allIds is currently selected → clears.
   * Otherwise → selects all allIds.
   */
  toggleAll: () => void
  /** Clear the entire selection. */
  clear: () => void
  /** True only when allIds is non-empty and every id is selected. */
  allSelected: boolean
  /**
   * True when count > 0 and not allSelected (indeterminate state for
   * a "select all" checkbox).
   */
  someSelected: boolean
  /** Number of currently-selected ids that are still present in allIds. */
  count: number
}

export function useRowSelection<Id extends string>(allIds: Id[]): RowSelectionReturn<Id> {
  const [selected, setSelected] = useState<Set<Id>>(() => new Set())

  const { count, allSelected, someSelected } = useMemo(
    () => computeSelectionState(allIds, selected),
    [allIds, selected],
  )

  const isSelected = useCallback(
    (id: Id) => {
      // Must be in allIds AND in selected
      return selected.has(id) && allIds.includes(id)
    },
    [allIds, selected],
  )

  const toggle = useCallback((id: Id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      // Determine if all allIds are currently selected (intersect on read)
      const currentAllSelected = allIds.length > 0 && allIds.every((id) => prev.has(id))
      if (currentAllSelected) {
        return new Set<Id>()
      }
      return new Set<Id>(allIds)
    })
  }, [allIds])

  const clear = useCallback(() => {
    setSelected(new Set())
  }, [])

  return {
    selected,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
    count,
  }
}
