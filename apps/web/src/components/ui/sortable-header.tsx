import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SortState } from '../../lib/use-sortable-data'

interface SortableHeaderProps<K extends string> {
  field: K
  sort: SortState<K>
  onToggle: (key: K) => void
  children: ReactNode
  className?: string
}

export function SortableHeader<K extends string>({
  field,
  sort,
  onToggle,
  children,
  className = '',
}: SortableHeaderProps<K>) {
  const isActive = sort !== null && sort.key === field
  const direction = isActive ? sort.direction : null

  const ariaSort: 'ascending' | 'descending' | 'none' = isActive
    ? direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'

  return (
    <th aria-sort={ariaSort} className={className}>
      <button
        type="button"
        onClick={() => onToggle(field)}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {children}
        {isActive && direction === 'asc' ? (
          <ChevronUp size={14} aria-hidden="true" />
        ) : isActive && direction === 'desc' ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronsUpDown size={14} aria-hidden="true" className="text-slate-400" />
        )}
      </button>
    </th>
  )
}
