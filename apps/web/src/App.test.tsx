import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppShell } from './App'

function renderShellAt(path: string) {
  const client = new QueryClient()
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell routes', () => {
  it('renders a not-found page for unknown dashboard routes', () => {
    const markup = renderShellAt('/does-not-exist')

    expect(markup).toContain('Page not found')
    expect(markup).toContain('Return to overview')
  })

  it('uses a responsive shell so mobile viewports are not consumed by the sidebar', () => {
    const markup = renderShellAt('/')

    expect(markup).toContain('flex-col')
    expect(markup).toContain('md:flex-row')
    expect(markup).toContain('md:w-56')
    // The mobile nav wraps its links into an even strip instead of forcing a
    // horizontal scroll, so no link bleeds past the viewport edge.
    expect(markup).toContain('flex flex-wrap')
    expect(markup).toContain('min-w-0')
  })
})
