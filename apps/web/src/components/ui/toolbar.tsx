import type { ReactNode } from 'react'

interface TableToolbarProps {
  children: ReactNode
  actions?: ReactNode
}

export function TableToolbar({ children, actions }: TableToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 justify-between">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions != null && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}
