import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { type ReactNode, useRef } from 'react'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger

interface DialogContentProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function DialogContent({
  title,
  description,
  children,
  className = '',
}: DialogContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
      <RadixDialog.Content
        ref={contentRef}
        // Send initial focus to the first field a dialog opts in with
        // `data-autofocus` so the user can type right away instead of landing
        // on the close button. Dialogs without one keep Radix's default.
        onOpenAutoFocus={(event) => {
          const target = contentRef.current?.querySelector<HTMLElement>('[data-autofocus]')
          if (target) {
            event.preventDefault()
            target.focus()
          }
        }}
        className={`fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white shadow-xl focus-visible:outline-none ${className}`}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
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
            className="ml-4 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <X size={16} />
          </RadixDialog.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

export const DialogClose = RadixDialog.Close
