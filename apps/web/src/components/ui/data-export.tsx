import { Download } from 'lucide-react'
import type { CsvColumn } from '../../lib/csv'
import { downloadCsv, toCsv } from '../../lib/csv'
import { Button } from './button'

interface ExportButtonProps<T> {
  rows: T[]
  columns: CsvColumn<T>[]
  filename: string
  label?: string
}

export function ExportButton<T>({
  rows,
  columns,
  filename,
  label = 'Export CSV',
}: ExportButtonProps<T>) {
  function handleClick() {
    downloadCsv(filename, toCsv(rows, columns))
  }

  return (
    <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={handleClick}>
      <Download size={14} />
      {label}
    </Button>
  )
}
