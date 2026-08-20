import { describe, expect, it } from 'vitest'
import { computeSelectionState } from './use-row-selection'

describe('computeSelectionState', () => {
  it('returns count=0, allSelected=false, someSelected=false for empty selected', () => {
    const result = computeSelectionState(['a', 'b', 'c'], new Set())
    expect(result).toEqual({ count: 0, allSelected: false, someSelected: false })
  })

  it('returns allSelected=true when all ids are selected', () => {
    const result = computeSelectionState(['a', 'b'], new Set(['a', 'b']))
    expect(result).toEqual({ count: 2, allSelected: true, someSelected: false })
  })

  it('returns someSelected=true when some but not all ids are selected', () => {
    const result = computeSelectionState(['a', 'b', 'c'], new Set(['a']))
    expect(result.someSelected).toBe(true)
    expect(result.allSelected).toBe(false)
    expect(result.count).toBe(1)
  })

  it('returns allSelected=false when allIds is empty', () => {
    const result = computeSelectionState([], new Set())
    expect(result.allSelected).toBe(false)
    expect(result.someSelected).toBe(false)
    expect(result.count).toBe(0)
  })

  it('prunes stale ids: count only counts ids still in allIds', () => {
    // selected has 'a' and 'stale'; allIds only has 'a' and 'b'
    const result = computeSelectionState(['a', 'b'], new Set(['a', 'stale']))
    expect(result.count).toBe(1)
    expect(result.allSelected).toBe(false)
    expect(result.someSelected).toBe(true)
  })

  it('reports allSelected=true after pruning when active ids are all selected', () => {
    // selected has 'a','b','stale'; allIds is just ['a','b']
    const result = computeSelectionState(['a', 'b'], new Set(['a', 'b', 'stale']))
    expect(result.allSelected).toBe(true)
    expect(result.someSelected).toBe(false)
    expect(result.count).toBe(2)
  })

  it('returns someSelected=false when no active ids are selected (only stale)', () => {
    const result = computeSelectionState(['a', 'b'], new Set(['stale']))
    expect(result.count).toBe(0)
    expect(result.allSelected).toBe(false)
    expect(result.someSelected).toBe(false)
  })
})
