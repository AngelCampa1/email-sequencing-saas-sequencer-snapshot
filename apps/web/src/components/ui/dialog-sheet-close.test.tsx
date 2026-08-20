import type { ComponentProps, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DialogContent } from './dialog'
import { SheetContent } from './sheet'

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ children }: { children: ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: (props: ComponentProps<'div'>) => <div {...props} />,
  Content: (props: ComponentProps<'div'>) => <div {...props} />,
  Title: (props: ComponentProps<'div'>) => <div {...props} />,
  Description: (props: ComponentProps<'p'>) => <p {...props} />,
  Close: (props: ComponentProps<'button'>) => <button {...props} />,
}))

describe('modal close controls', () => {
  it('labels the dialog close icon button', () => {
    const markup = renderToStaticMarkup(
      <DialogContent title="Preview message">Dialog body</DialogContent>,
    )

    expect(markup).toContain('aria-label="Close"')
  })

  it('keeps dialog content within short mobile viewports', () => {
    const markup = renderToStaticMarkup(
      <DialogContent title="Preview message">Dialog body</DialogContent>,
    )

    expect(markup).toContain('w-[calc(100vw-2rem)]')
    expect(markup).toContain('max-h-[calc(100dvh-2rem)]')
    expect(markup).toContain('overflow-y-auto')
  })

  it('labels the sheet close icon button', () => {
    const markup = renderToStaticMarkup(
      <SheetContent title="Contact details">Sheet body</SheetContent>,
    )

    expect(markup).toContain('aria-label="Close"')
  })

  it('keeps sheet content within narrow mobile viewports', () => {
    const markup = renderToStaticMarkup(
      <SheetContent title="Contact details">Sheet body</SheetContent>,
    )

    expect(markup).toContain('w-full')
    expect(markup).toContain('max-w-[420px]')
    expect(markup).not.toContain(' h-full w-[420px] ')
  })

  it('renders a sheet description when the description prop is passed', () => {
    const markup = renderToStaticMarkup(
      <SheetContent title="Contact details" description="What this panel shows.">
        Sheet body
      </SheetContent>,
    )

    expect(markup).toContain('What this panel shows.')
  })

  it('omits the sheet description node when no description is given', () => {
    const markup = renderToStaticMarkup(
      <SheetContent title="Contact details">Sheet body</SheetContent>,
    )

    // The description node (with its muted text class) should not be rendered.
    expect(markup).not.toContain('text-slate-500')
  })
})
