import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface CopyButtonProps {
  /** The text written to the clipboard when the button is pressed. */
  value: string
  /** Accessible label for the action, e.g. "Copy reference". */
  label: string
  className?: string
}

/**
 * Small icon button that copies a value to the clipboard and briefly shows a
 * check to confirm. Falls back gracefully when the clipboard API is missing
 * (older browsers, insecure contexts) so it never throws on click.
 */
export function CopyButton({ value, label, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(value)
    } catch {
      return
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied' : label}
      className={`inline-flex shrink-0 items-center justify-center rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${className}`}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </button>
  )
}
