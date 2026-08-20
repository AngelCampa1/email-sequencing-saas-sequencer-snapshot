import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  className?: string
}

/**
 * The dashboard's standard "nothing here yet" placeholder: a muted icon, a
 * short title, and an optional line explaining when content will appear. Used
 * for empty tables and lists so every empty state looks the same.
 */
export function EmptyState({ icon: Icon, title, description, className = '' }: EmptyStateProps) {
  return (
    <div className={`px-5 py-12 text-center ${className}`.trim()}>
      <Icon size={32} className="mx-auto text-slate-300 mb-3" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>}
    </div>
  )
}
