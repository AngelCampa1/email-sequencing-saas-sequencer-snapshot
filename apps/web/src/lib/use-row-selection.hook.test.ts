// @vitest-environment jsdom
import '../test/interaction-setup'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRowSelection } from './use-row-selection'

describe('useRowSelection hook', () => {
  it('starts with nothing selected', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b', 'c']))
    expect(result.current.count).toBe(0)
    expect(result.current.allSelected).toBe(false)
    expect(result.current.someSelected).toBe(false)
    expect(result.current.selected.size).toBe(0)
  })

  it('toggle selects an unselected id', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b', 'c']))
    act(() => result.current.toggle('a'))
    expect(result.current.isSelected('a')).toBe(true)
    expect(result.current.count).toBe(1)
  })

  it('toggle deselects an already-selected id', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b', 'c']))
    act(() => result.current.toggle('a'))
    act(() => result.current.toggle('a'))
    expect(result.current.isSelected('a')).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('toggle produces a new Set on each update (immutability)', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b']))
    const before = result.current.selected
    act(() => result.current.toggle('a'))
    expect(result.current.selected).not.toBe(before)
  })

  it('toggleAll selects all when nothing is selected', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b', 'c']))
    act(() => result.current.toggleAll())
    expect(result.current.allSelected).toBe(true)
    expect(result.current.count).toBe(3)
  })

  it('toggleAll selects all when some are selected', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b', 'c']))
    act(() => result.current.toggle('a'))
    act(() => result.current.toggleAll())
    expect(result.current.allSelected).toBe(true)
    expect(result.current.count).toBe(3)
  })

  it('toggleAll clears when all are already selected', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b']))
    act(() => result.current.toggleAll())
    act(() => result.current.toggleAll())
    expect(result.current.allSelected).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('clear empties the selection', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b']))
    act(() => result.current.toggleAll())
    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
    expect(result.current.selected.size).toBe(0)
  })

  it('someSelected is true only when count>0 and not allSelected', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b', 'c']))
    act(() => result.current.toggle('a'))
    expect(result.current.someSelected).toBe(true)
    expect(result.current.allSelected).toBe(false)
  })

  it('someSelected is false when allSelected', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b']))
    act(() => result.current.toggleAll())
    expect(result.current.someSelected).toBe(false)
    expect(result.current.allSelected).toBe(true)
  })

  it('isSelected returns false for unknown id', () => {
    const { result } = renderHook(() => useRowSelection(['a', 'b'] as string[]))
    expect(result.current.isSelected('z')).toBe(false)
  })

  it('pruning: when allIds shrinks, stale ids drop from derived counts', () => {
    // Start with 3 ids, select all
    let allIds = ['a', 'b', 'c']
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useRowSelection(ids), {
      initialProps: { ids: allIds },
    })
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(3)

    // Shrink allIds to ['a','b'] — 'c' is now stale
    allIds = ['a', 'b']
    rerender({ ids: allIds })

    // count must reflect only still-present ids
    expect(result.current.count).toBe(2)
    expect(result.current.allSelected).toBe(true)
  })

  it('pruning: allSelected becomes false after shrink reveals a gap', () => {
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useRowSelection(ids), {
      initialProps: { ids: ['a', 'b', 'c'] },
    })
    // Select only a and b
    act(() => result.current.toggle('a'))
    act(() => result.current.toggle('b'))
    expect(result.current.allSelected).toBe(false)

    // Shrink to just ['a'] — b is now stale but was selected; c was never selected
    rerender({ ids: ['a'] })
    expect(result.current.count).toBe(1)
    expect(result.current.allSelected).toBe(true)
  })
})
