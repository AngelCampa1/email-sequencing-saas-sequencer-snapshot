import * as RadixTabs from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

export const Tabs = RadixTabs.Root

interface TabsListProps {
  children: ReactNode
  className?: string
}

export function TabsList({ children, className = '' }: TabsListProps) {
  return (
    <RadixTabs.List className={`inline-flex rounded-lg bg-slate-100 p-1 gap-0.5 ${className}`}>
      {children}
    </RadixTabs.List>
  )
}

interface TabsTriggerProps {
  value: string
  children: ReactNode
}

export function TabsTrigger({ value, children }: TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      value={value}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      {children}
    </RadixTabs.Trigger>
  )
}

interface TabsContentProps {
  value: string
  children: ReactNode
  className?: string
}

export function TabsContent({ value, children, className = '' }: TabsContentProps) {
  return (
    <RadixTabs.Content value={value} className={`mt-4 ${className}`}>
      {children}
    </RadixTabs.Content>
  )
}
