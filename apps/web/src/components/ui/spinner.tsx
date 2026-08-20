import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  size?: number
  className?: string
  /** Accessible label for screen readers. Defaults to "Loading". */
  label?: string
}

/**
 * Small spinning indicator for in-progress actions, built on the same
 * Loader2 + animate-spin used for full-page loads. Used inline inside buttons
 * while a mutation is pending so the affordance reads the same everywhere.
 */
export function Spinner({ size = 13, className = '', label = 'Loading' }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      className={`animate-spin ${className}`.trim()}
      role="status"
      aria-label={label}
    />
  )
}
