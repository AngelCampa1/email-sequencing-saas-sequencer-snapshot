import { describe, expect, it } from 'vitest'
import type { SortableColumn, SortState } from './use-sortable-data'
import { sortRows } from './use-sortable-data'

// ---- fixtures ----

interface Row {
  name: string
  score: number | null | undefined
  tag: string | null
}

const rows: Row[] = [
  { name: 'Banana', score: 30, tag: 'b' },
  { name: 'apple', score: 10, tag: 'a' },
  { name: 'Cherry', score: 20, tag: null },
  { name: 'date', score: null, tag: 'd' },
  { name: 'Elderberry', score: undefined, tag: 'e' },
]

type RowKey = 'name' | 'score' | 'tag'

const columns: SortableColumn<Row, RowKey>[] = [
  { key: 'name', accessor: (r) => r.name },
  { key: 'score', accessor: (r) => r.score },
  { key: 'tag', accessor: (r) => r.tag },
]

// ---- sortRows: null sort → original order ----

describe('sortRows: null sort', () => {
  it('returns rows in original order when sort is null', () => {
    const result = sortRows(rows, columns, null)
    expect(result.map((r) => r.name)).toEqual(['Banana', 'apple', 'Cherry', 'date', 'Elderberry'])
  })

  it('does not mutate the input array', () => {
    const input = [...rows]
    const original = input.map((r) => r.name)
    sortRows(input, columns, { key: 'name', direction: 'asc' })
    expect(input.map((r) => r.name)).toEqual(original)
  })
})

// ---- sortRows: string column ----

describe('sortRows: string column asc', () => {
  const sort: SortState<RowKey> = { key: 'name', direction: 'asc' }

  it('sorts strings ascending case-insensitively', () => {
    const result = sortRows(rows, columns, sort)
    // null/undefined tag rows excluded here; name col has no nulls
    const names = result.map((r) => r.name)
    // 'apple' < 'Banana' < 'Cherry' < 'date' < 'Elderberry' (case-insensitive)
    expect(names).toEqual(['apple', 'Banana', 'Cherry', 'date', 'Elderberry'])
  })
})

describe('sortRows: string column desc', () => {
  const sort: SortState<RowKey> = { key: 'name', direction: 'desc' }

  it('sorts strings descending case-insensitively', () => {
    const result = sortRows(rows, columns, sort)
    const names = result.map((r) => r.name)
    expect(names).toEqual(['Elderberry', 'date', 'Cherry', 'Banana', 'apple'])
  })
})

// ---- sortRows: numeric column ----

describe('sortRows: numeric column asc', () => {
  const sort: SortState<RowKey> = { key: 'score', direction: 'asc' }

  it('sorts numbers numerically ascending, nulls/undefineds last', () => {
    const result = sortRows(rows, columns, sort)
    const scores = result.map((r) => r.score)
    // 10, 20, 30, then null, undefined (last — order among them is stable)
    expect(scores[0]).toBe(10)
    expect(scores[1]).toBe(20)
    expect(scores[2]).toBe(30)
    // last two are null/undefined
    expect(scores[3] == null).toBe(true)
    expect(scores[4] == null).toBe(true)
  })
})

describe('sortRows: numeric column desc', () => {
  const sort: SortState<RowKey> = { key: 'score', direction: 'desc' }

  it('sorts numbers numerically descending, nulls/undefineds last', () => {
    const result = sortRows(rows, columns, sort)
    const scores = result.map((r) => r.score)
    expect(scores[0]).toBe(30)
    expect(scores[1]).toBe(20)
    expect(scores[2]).toBe(10)
    // nulls last regardless of direction
    expect(scores[3] == null).toBe(true)
    expect(scores[4] == null).toBe(true)
  })
})

// ---- sortRows: null/undefined always last ----

describe('sortRows: nulls-last behaviour', () => {
  it('null values are always sorted last in asc', () => {
    const sort: SortState<RowKey> = { key: 'tag', direction: 'asc' }
    const result = sortRows(rows, columns, sort)
    // tag: 'b', 'a', null, 'd', 'e' → sorted: a, b, d, e, null
    const last = result[result.length - 1]
    expect(last.tag).toBeNull()
  })

  it('null values are always sorted last in desc', () => {
    const sort: SortState<RowKey> = { key: 'tag', direction: 'desc' }
    const result = sortRows(rows, columns, sort)
    const last = result[result.length - 1]
    expect(last.tag).toBeNull()
  })
})

// ---- sortRows: stability ----

describe('sortRows: stability', () => {
  it('is stable — equal-value rows preserve original relative order', () => {
    const dupes: Row[] = [
      { name: 'Alpha', score: 5, tag: 'x' },
      { name: 'Beta', score: 5, tag: 'y' },
      { name: 'Gamma', score: 5, tag: 'z' },
    ]
    const sort: SortState<RowKey> = { key: 'score', direction: 'asc' }
    const result = sortRows(dupes, columns, sort)
    expect(result.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})

// ---- sortRows: unknown key ----

describe('sortRows: unknown key', () => {
  it('returns original order when column key is not found in columns', () => {
    const sort = { key: 'nonexistent' as RowKey, direction: 'asc' as const }
    const result = sortRows(rows, columns, sort)
    expect(result.map((r) => r.name)).toEqual(rows.map((r) => r.name))
  })
})
