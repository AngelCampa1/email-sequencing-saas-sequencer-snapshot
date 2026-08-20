import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import { Select, SelectItem } from './select'

interface TablePaginationProps {
  /** 1-indexed current page */
  page: number
  pageSize: number
  /** When known, enables "X–Y of N" label and bounds-based Next disabling */
  total?: number
  /** For cursor/has_next style pagination when total is unknown */
  hasMore?: boolean
  onPrev: () => void
  onNext: () => void
  pageSizeOptions?: number[]
  onPageSizeChange?: (n: number) => void
}

function buildLabel(page: number, pageSize: number, total?: number): string {
  if (total === undefined) {
    return `Page ${page}`
  }
  if (total === 0) {
    return '0–0 of 0'
  }
  const x = (page - 1) * pageSize + 1
  const y = Math.min(page * pageSize, total)
  return `${x}–${y} of ${total}`
}

function isNextDisabled(
  page: number,
  pageSize: number,
  total?: number,
  hasMore?: boolean,
): boolean {
  if (total !== undefined) {
    return page * pageSize >= total
  }
  if (hasMore === false) {
    return true
  }
  return false
}

export function TablePagination({
  page,
  pageSize,
  total,
  hasMore,
  onPrev,
  onNext,
  pageSizeOptions,
  onPageSizeChange,
}: TablePaginationProps) {
  const prevDisabled = page <= 1
  const nextDisabled = isNextDisabled(page, pageSize, total, hasMore)
  const label = buildLabel(page, pageSize, total)
  const showSizeSelect =
    pageSizeOptions !== undefined && pageSizeOptions.length > 0 && onPageSizeChange !== undefined

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-600 tabular-nums">{label}</span>

      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
        Prev
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label="Next page"
      >
        Next
        <ChevronRight size={14} />
      </Button>

      {showSizeSelect && (
        <div className="flex items-center gap-1.5">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange!(Number(v))}
            aria-label="Rows per page"
          >
            {pageSizeOptions!.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </Select>
          <span className="text-sm text-slate-500">per page</span>
        </div>
      )}
    </div>
  )
}
