import { useCallback, useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc'

export type SortState<K extends string> = { key: K; direction: SortDirection } | null

export interface SortableColumn<T, K extends string> {
  key: K
  accessor: (row: T) => string | number | null | undefined
}

/**
 * Pure sort function — no React, fully unit-testable.
 *
 * Rules:
 * - null/undefined values always sort last regardless of direction.
 * - Numbers are compared numerically.
 * - Strings are compared via localeCompare (case-insensitive, sensitivity:'base').
 * - Sort is stable (preserves original relative order for equal values).
 * - Returns original order when sort is null or the key is not found.
 */
export function sortRows<T, K extends string>(
  rows: T[],
  columns: SortableColumn<T, K>[],
  sort: SortState<K>,
): T[] {
  if (sort === null) return [...rows]

  const col = columns.find((c) => c.key === sort.key)
  if (!col) return [...rows]

  const { accessor } = col
  const dir = sort.direction === 'asc' ? 1 : -1

  // Attach original indices for stability
  const indexed = rows.map((row, i) => ({ row, i, val: accessor(row) }))

  indexed.sort((a, b) => {
    const av = a.val
    const bv = b.val

    // nulls/undefined always last
    const aNull = av == null
    const bNull = bv == null
    if (aNull && bNull) return a.i - b.i
    if (aNull) return 1
    if (bNull) return -1

    let cmp: number
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    }

    if (cmp !== 0) return cmp * dir
    // stable: preserve original order for ties
    return a.i - b.i
  })

  return indexed.map((x) => x.row)
}

/**
 * Hook that wraps sortRows with toggle state.
 * Tri-state cycle: null → asc → desc → null
 * Switching to a different key resets to asc.
 */
export function useSortableData<T, K extends string>(
  rows: T[],
  columns: SortableColumn<T, K>[],
  initial?: SortState<K>,
): { sorted: T[]; sort: SortState<K>; toggleSort: (key: K) => void } {
  const [sort, setSort] = useState<SortState<K>>(initial ?? null)

  const toggleSort = useCallback((key: K) => {
    setSort((prev) => {
      if (prev === null || prev.key !== key) {
        return { key, direction: 'asc' }
      }
      if (prev.direction === 'asc') {
        return { key, direction: 'desc' }
      }
      // desc → null
      return null
    })
  }, [])

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])

  return { sorted, sort, toggleSort }
}
