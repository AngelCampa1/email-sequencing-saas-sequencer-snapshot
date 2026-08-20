import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  children: ReactNode
  className?: string
}

export function Select({
  value,
  onValueChange,
  placeholder,
  id,
  children,
  className = '',
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={`inline-flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
      >
        <RadixSelect.Value placeholder={placeholder ?? 'Select...'} />
        <RadixSelect.Icon>
          <ChevronDown size={14} className="text-slate-400" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[8rem] overflow-hidden rounded-md border border-slate-200 bg-white shadow-md"
        >
          <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

interface SelectItemProps {
  value: string
  children: ReactNode
}

export function SelectItem({ value, children }: SelectItemProps) {
  return (
    <RadixSelect.Item
      value={value}
      className="relative flex cursor-pointer items-center rounded px-7 py-1.5 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100"
    >
      <RadixSelect.ItemIndicator className="absolute left-2">
        <Check size={12} />
      </RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  )
}
