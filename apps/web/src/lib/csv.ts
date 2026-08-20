export interface CsvColumn<T> {
  header: string
  accessor: (row: T) => string | number | null | undefined
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // RFC-4180: wrap in double quotes if cell contains comma, double-quote, CR, or LF
  if (str.includes(',') || str.includes('"') || str.includes('\r') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',')
  if (rows.length === 0) return header

  const dataRows = rows.map((row) => columns.map((c) => escapeCell(c.accessor(row))).join(','))

  return [header, ...dataRows].join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === 'undefined') return

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Defer revoking the blob URL to a later tick. Revoking synchronously right
  // after a synthetic click() can produce an empty download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
