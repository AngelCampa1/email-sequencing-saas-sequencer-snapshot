// @vitest-environment jsdom
import '../test/interaction-setup'

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SortableColumn } from './use-sortable-data'
import { useSortableData } from './use-sortable-data'

interface Item {
  label: string
  value: number
}

const items: Item[] = [
  { label: 'Banana', value: 30 },
  { label: 'apple', value: 10 },
  { label: 'Cherry', value: 20 },
]

type ItemKey = 'label' | 'value'

const columns: SortableColumn<Item, ItemKey>[] = [
  { key: 'label', accessor: (r) => r.label },
  { key: 'value', accessor: (r) => r.value },
]

describe('useSortableData: initial state', () => {
  it('starts with null sort and original order when no initial provided', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    expect(result.current.sort).toBeNull()
    expect(result.current.sorted.map((r) => r.label)).toEqual(['Banana', 'apple', 'Cherry'])
  })

  it('starts with the provided initial sort state', () => {
    const { result } = renderHook(() =>
      useSortableData(items, columns, { key: 'label', direction: 'asc' }),
    )
    expect(result.current.sort).toEqual({ key: 'label', direction: 'asc' })
    expect(result.current.sorted[0].label).toBe('apple')
  })
})

describe('useSortableData: toggleSort tri-state cycle', () => {
  it('transitions null → asc on first toggle', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    expect(result.current.sort).toEqual({ key: 'label', direction: 'asc' })
  })

  it('transitions asc → desc on second toggle of same key', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    expect(result.current.sort).toEqual({ key: 'label', direction: 'desc' })
  })

  it('transitions desc → null on third toggle of same key', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    expect(result.current.sort).toBeNull()
  })

  it('restores original order when sort returns to null', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    expect(result.current.sorted.map((r) => r.label)).toEqual(['Banana', 'apple', 'Cherry'])
  })
})

describe('useSortableData: switching keys', () => {
  it('switching to a different key resets to asc', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    // currently desc on label; now toggle value
    act(() => result.current.toggleSort('value'))
    expect(result.current.sort).toEqual({ key: 'value', direction: 'asc' })
  })

  it('sorted output reflects the new key after switching', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('value'))
    // value asc: 10, 20, 30 → apple, Cherry, Banana
    expect(result.current.sorted.map((r) => r.value)).toEqual([10, 20, 30])
  })
})

describe('useSortableData: sorted output tracks sort state', () => {
  it('sorted output is ascending when sort is asc', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    const labels = result.current.sorted.map((r) => r.label)
    expect(labels[0].toLowerCase()).toBe('apple')
  })

  it('sorted output is descending when sort is desc', () => {
    const { result } = renderHook(() => useSortableData(items, columns))
    act(() => result.current.toggleSort('label'))
    act(() => result.current.toggleSort('label'))
    const labels = result.current.sorted.map((r) => r.label)
    expect(labels[0].toLowerCase()).toBe('cherry')
  })
})
