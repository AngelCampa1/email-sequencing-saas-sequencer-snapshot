import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export const Sheet = RadixDialog.Root
export const SheetTrigger = RadixDialog.Trigger
export const SheetClose = RadixDialog.Close

interface SheetContentProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function SheetContent({ title, description, children, className = '' }: SheetContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
      <RadixDialog.Content
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col bg-white shadow-2xl focus-visible:outline-none ${className}`}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 shrink-0">
          <div>
            <RadixDialog.Title className="text-base font-semibold text-slate-900">
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-0.5 text-sm text-slate-500">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <X size={16} />
          </RadixDialog.Close>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
