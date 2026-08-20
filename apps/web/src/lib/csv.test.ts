import { describe, expect, it, vi } from 'vitest'
import { downloadCsv, toCsv } from './csv'

interface Row {
  name: string
  count: number
  note?: string
}

const columns = [
  { header: 'Name', accessor: (r: Row) => r.name },
  { header: 'Count', accessor: (r: Row) => r.count },
  { header: 'Note', accessor: (r: Row) => r.note },
]

describe('toCsv', () => {
  it('produces header row from column headers', () => {
    const csv = toCsv([], columns)
    expect(csv).toBe('Name,Count,Note')
  })

  it('returns only header when rows array is empty', () => {
    const csv = toCsv<Row>([], columns)
    expect(csv).toBe('Name,Count,Note')
    expect(csv.split('\r\n').length).toBe(1)
  })

  it('converts a number cell to a string', () => {
    const csv = toCsv([{ name: 'Alice', count: 42 }], columns)
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('Alice,42,')
  })

  it('converts null to empty string', () => {
    const cols = [{ header: 'Val', accessor: (_: object) => null as null }]
    const csv = toCsv([{}], cols)
    expect(csv).toBe('Val\r\n')
  })

  it('converts undefined to empty string', () => {
    const csv = toCsv([{ name: 'Bob', count: 1 }], columns)
    const lines = csv.split('\r\n')
    // note is undefined — last cell should be empty (line ends with comma)
    expect(lines[1].endsWith(',')).toBe(true)
  })

  it('joins rows with CRLF', () => {
    const rows = [
      { name: 'A', count: 1 },
      { name: 'B', count: 2 },
    ]
    const csv = toCsv(rows, columns)
    // header + row1 + row2 = 3 segments joined by \r\n
    expect(csv).toContain('\r\n')
    const lines = csv.split('\r\n')
    expect(lines.length).toBe(3)
  })

  it('wraps cells containing a comma in double quotes', () => {
    const rows = [{ name: 'Smith, John', count: 1 }]
    const csv = toCsv(rows, columns)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine).toContain('"Smith, John"')
  })

  it('wraps cells containing a double-quote and doubles the embedded quote', () => {
    const rows = [{ name: 'Say "hello"', count: 1 }]
    const csv = toCsv(rows, columns)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine).toContain('"Say ""hello"""')
  })

  it('wraps cells containing a CR', () => {
    const rows = [{ name: 'line1\rline2', count: 1 }]
    const csv = toCsv(rows, columns)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine.startsWith('"')).toBe(true)
  })

  it('wraps cells containing a LF', () => {
    const rows = [{ name: 'line1\nline2', count: 1 }]
    const csv = toCsv(rows, columns)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine.startsWith('"')).toBe(true)
  })

  it('handles multiple columns correctly', () => {
    const rows = [{ name: 'Zara', count: 99, note: 'ok' }]
    const csv = toCsv(rows, columns)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Name,Count,Note')
    expect(lines[1]).toBe('Zara,99,ok')
  })

  it('handles a cell that is 0 (falsy number)', () => {
    const rows = [{ name: 'zero', count: 0 }]
    const csv = toCsv(rows, columns)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine).toBe('zero,0,')
  })

  it('handles an empty string cell without quoting', () => {
    const cols = [{ header: 'V', accessor: (_: object) => '' as string }]
    const csv = toCsv([{}], cols)
    expect(csv).toBe('V\r\n')
  })
})

describe('downloadCsv (non-browser guard)', () => {
  it('returns early when document is not defined (node env)', () => {
    // In the node test environment document is undefined; calling downloadCsv
    // must not throw.
    expect(() => downloadCsv('out.csv', 'a,b')).not.toThrow()
  })

  it('proceeds through the browser path when document IS defined', () => {
    // Cover the false branch of the `typeof document === 'undefined'` guard in
    // the node env (v8 does not reliably merge this branch across the jsdom
    // suite). Stub a minimal document + URL so the body runs without throwing.
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    const appendChild = vi.fn()
    const removeChild = vi.fn()
    const createElement = vi.fn(() => anchor)
    const createObjectURL = vi.fn(() => 'blob:stub')
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('document', {
      createElement,
      body: { appendChild, removeChild },
    })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('Blob', class {})
    vi.useFakeTimers()

    try {
      downloadCsv('report.csv', 'a,b\r\n1,2')
      expect(createElement).toHaveBeenCalledWith('a')
      expect(anchor.download).toBe('report.csv')
      expect(click).toHaveBeenCalledTimes(1)
      expect(appendChild).toHaveBeenCalledWith(anchor)
      expect(removeChild).toHaveBeenCalledWith(anchor)
      // Revoke is deferred to a later tick to avoid empty downloads in some
      // browsers; it must not have fired synchronously after click().
      expect(revokeObjectURL).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:stub')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
