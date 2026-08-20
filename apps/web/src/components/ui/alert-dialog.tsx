import * as RadixAlertDialog from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'

export const AlertDialog = RadixAlertDialog.Root
export const AlertDialogTrigger = RadixAlertDialog.Trigger
export const AlertDialogCancel = RadixAlertDialog.Cancel
export const AlertDialogAction = RadixAlertDialog.Action

interface AlertDialogContentProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function AlertDialogContent({
  title,
  description,
  children,
  className = '',
}: AlertDialogContentProps) {
  return (
    <RadixAlertDialog.Portal>
      <RadixAlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
      <RadixAlertDialog.Content
        className={`fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white shadow-xl focus-visible:outline-none ${className}`}
      >
        <div className="px-5 py-4">
          <RadixAlertDialog.Title className="text-base font-semibold text-slate-900">
            {title}
          </RadixAlertDialog.Title>
          {description && (
            <RadixAlertDialog.Description className="mt-1 text-sm text-slate-500">
              {description}
            </RadixAlertDialog.Description>
          )}
        </div>
        <div className="px-5 pb-4">{children}</div>
      </RadixAlertDialog.Content>
    </RadixAlertDialog.Portal>
  )
}
