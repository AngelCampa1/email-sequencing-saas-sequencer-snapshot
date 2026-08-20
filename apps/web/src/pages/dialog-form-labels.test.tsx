import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductRow } from '../lib/types'
import { SettingsPage } from './SettingsPage'
import { SuppressionsPage } from './SuppressionsPage'

vi.mock('react-router', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}))

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ children }: { children: ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: (props: ComponentProps<'div'>) => <div {...props} />,
  Content: (props: ComponentProps<'div'>) => <div {...props} />,
  Title: (props: ComponentProps<'div'>) => <div {...props} />,
  Description: (props: ComponentProps<'p'>) => <p {...props} />,
  Close: ({ asChild: _asChild, ...props }: ComponentProps<'button'> & { asChild?: boolean }) => (
    <button {...props} />
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}))

const mockUseMutation = vi.mocked(useMutation)
const mockUseQuery = vi.mocked(useQuery)
const mockUseQueryClient = vi.mocked(useQueryClient)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useQuery>
}

function mutationResult(value: Partial<ReturnType<typeof useMutation>> = {}) {
  return {
    isPending: false,
    mutate: vi.fn(),
    error: null,
    ...value,
  } as unknown as ReturnType<typeof useMutation>
}

const product: ProductRow = {
  id: 'prod_camaudit',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT',
  suppression_scope: 'product',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('dialog form labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue(mutationResult())
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: unknown[] }).queryKey
      if (key[0] === 'products') {
        return queryResult({ data: [product] })
      }
      if (key[0] === 'api-tokens') {
        return queryResult({ data: [] })
      }
      if (key[0] === 'suppressions') {
        return queryResult({ data: [] })
      }
      return queryResult({})
    })
  })

  it('programmatically labels the add suppression form fields', () => {
    const markup = renderToStaticMarkup(<SuppressionsPage />)

    expect(markup).toContain('for="suppression-email"')
    expect(markup).toContain('id="suppression-email"')
    expect(markup).toContain('for="suppression-scope"')
    expect(markup).toContain('id="suppression-scope"')
    expect(markup).toContain('for="suppression-reason"')
    expect(markup).toContain('id="suppression-reason"')
  })

  it('programmatically labels the service token setup form fields', () => {
    const markup = renderToStaticMarkup(<SettingsPage />)

    expect(markup).toContain('for="token-label-prod_camaudit"')
    expect(markup).toContain('id="token-label-prod_camaudit"')
    expect(markup).toContain('for="token-access-client-id-prod_camaudit"')
    expect(markup).toContain('id="token-access-client-id-prod_camaudit"')
  })
})
