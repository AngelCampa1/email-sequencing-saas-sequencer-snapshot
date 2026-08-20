import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('renders a pill-shaped button by default', () => {
    const markup = renderToStaticMarkup(<Button>Click me</Button>)
    expect(markup).toContain('rounded-full')
  })

  it('applies default variant classes', () => {
    const markup = renderToStaticMarkup(<Button>Click me</Button>)
    expect(markup).toContain('bg-slate-900')
    expect(markup).toContain('text-white')
  })

  it('applies destructive-outline variant classes', () => {
    const markup = renderToStaticMarkup(<Button variant="destructive-outline">Remove</Button>)
    expect(markup).toContain('border-red-200')
    expect(markup).toContain('text-red-600')
    expect(markup).toContain('bg-white')
    expect(markup).toContain('hover:bg-red-50')
  })

  it('destructive-outline variant does not include default variant classes', () => {
    const markup = renderToStaticMarkup(<Button variant="destructive-outline">Remove</Button>)
    expect(markup).not.toContain('bg-slate-900')
    expect(markup).not.toContain('border-slate-300')
  })

  it('includes focus-visible outline ring for keyboard accessibility', () => {
    const markup = renderToStaticMarkup(<Button>Click me</Button>)
    expect(markup).toContain('focus-visible:outline')
    expect(markup).toContain('focus-visible:outline-blue-500')
  })

  it('merges extra className onto destructive-outline', () => {
    const markup = renderToStaticMarkup(
      <Button variant="destructive-outline" size="sm" className="h-6 px-2 text-xs">
        Remove
      </Button>,
    )
    expect(markup).toContain('border-red-200')
    expect(markup).toContain('text-red-600')
    expect(markup).toContain('h-6')
    expect(markup).toContain('px-2')
    expect(markup).toContain('text-xs')
    expect(markup).toContain('rounded-full')
  })
})
