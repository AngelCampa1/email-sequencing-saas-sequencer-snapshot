import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './card'

describe('Card', () => {
  it('renders with default classes', () => {
    const html = renderToStaticMarkup(<Card>content</Card>)
    expect(html).toContain('rounded-lg')
    expect(html).toContain('border-slate-200')
    expect(html).toContain('bg-white')
    expect(html).toContain('shadow-sm')
    expect(html).toContain('content')
  })

  it('merges extra className', () => {
    const html = renderToStaticMarkup(<Card className="extra-class">content</Card>)
    expect(html).toContain('extra-class')
    expect(html).toContain('rounded-lg')
  })

  it('passes through extra props', () => {
    const html = renderToStaticMarkup(<Card data-testid="my-card">content</Card>)
    expect(html).toContain('data-testid="my-card"')
  })
})

describe('CardHeader', () => {
  it('renders with default classes', () => {
    const html = renderToStaticMarkup(<CardHeader>header</CardHeader>)
    expect(html).toContain('px-5')
    expect(html).toContain('py-4')
    expect(html).toContain('border-b')
    expect(html).toContain('border-slate-100')
    expect(html).toContain('header')
  })

  it('merges extra className', () => {
    const html = renderToStaticMarkup(<CardHeader className="extra">header</CardHeader>)
    expect(html).toContain('extra')
    expect(html).toContain('px-5')
  })
})

describe('CardTitle', () => {
  it('renders as h3 with default classes', () => {
    const html = renderToStaticMarkup(<CardTitle>Title</CardTitle>)
    expect(html).toContain('<h3')
    expect(html).toContain('text-sm')
    expect(html).toContain('font-semibold')
    expect(html).toContain('text-slate-900')
    expect(html).toContain('Title')
  })

  it('merges extra className', () => {
    const html = renderToStaticMarkup(<CardTitle className="extra">Title</CardTitle>)
    expect(html).toContain('extra')
  })
})

describe('CardContent', () => {
  it('renders with default classes', () => {
    const html = renderToStaticMarkup(<CardContent>body</CardContent>)
    expect(html).toContain('px-5')
    expect(html).toContain('py-4')
    expect(html).toContain('body')
  })

  it('merges extra className', () => {
    const html = renderToStaticMarkup(<CardContent className="extra">body</CardContent>)
    expect(html).toContain('extra')
  })
})

describe('CardFooter', () => {
  it('renders with default classes', () => {
    const html = renderToStaticMarkup(<CardFooter>footer</CardFooter>)
    expect(html).toContain('px-5')
    expect(html).toContain('py-3')
    expect(html).toContain('border-t')
    expect(html).toContain('border-slate-100')
    expect(html).toContain('footer')
  })

  it('merges extra className', () => {
    const html = renderToStaticMarkup(<CardFooter className="extra">footer</CardFooter>)
    expect(html).toContain('extra')
    expect(html).toContain('border-t')
  })

  it('passes through extra props', () => {
    const html = renderToStaticMarkup(<CardFooter data-testid="footer">footer</CardFooter>)
    expect(html).toContain('data-testid="footer"')
  })
})
