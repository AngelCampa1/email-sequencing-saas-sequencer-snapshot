import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ContactsPage } from './ContactsPage'
import { SuppressionsPage } from './SuppressionsPage'

vi.mock('react-router', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}))

function renderPage(element: React.ReactElement) {
  const client = new QueryClient()
  return renderToStaticMarkup(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

describe('dashboard capped list disclosures', () => {
  it('does not describe the capped contacts response as all subscribers', () => {
    const markup = renderPage(<ContactsPage />)

    expect(markup).toContain('Showing the latest 50 contacts across products')
    expect(markup).not.toContain('All subscribers across products')
  })

  it('discloses the suppression list cap', () => {
    const markup = renderPage(<SuppressionsPage />)

    expect(markup).toContain('Showing up to 100 recent blocks in each tab')
    expect(markup).not.toContain('when a row is not visible')
  })
})
