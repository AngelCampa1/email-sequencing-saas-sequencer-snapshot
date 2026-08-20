import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revokeApiToken } from '../lib/api'
import type { ApiTokenRow, ProductRow } from '../lib/types'
import { SettingsPage } from './SettingsPage'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}))

const mockUseMutation = vi.mocked(useMutation)
const mockUseQuery = vi.mocked(useQuery)
const mockUseQueryClient = vi.mocked(useQueryClient)

function clearObservabilityEnv() {
  const env = import.meta.env as Record<string, string | undefined>
  delete env.VITE_CF_WORKERS_OBSERVABILITY_URL
  delete env.VITE_CF_ANALYTICS_ENGINE_URL
}

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return value as unknown as ReturnType<typeof useQuery>
}

function mutationResult(value: Partial<ReturnType<typeof useMutation>>) {
  return {
    isPending: false,
    mutate: vi.fn(),
    error: null,
    ...value,
  } as unknown as ReturnType<typeof useMutation>
}

const product: ProductRow = {
  id: 'product_1',
  slug: 'camaudit',
  name: 'CAMAudit',
  brand_color: '#123456',
  default_from_email: 'founder@camaudit.io',
  default_reply_to: null,
  resend_api_key_secret_name: 'RESEND_API_KEY_CAMAUDIT',
  suppression_scope: 'global',
  firewall_partner_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const activeToken: ApiTokenRow = {
  id: 'token_1',
  product_id: product.id,
  product_slug: product.slug,
  product_name: product.name,
  label: 'Production token',
  access_service_token_id: '00000000000000000000000000000000.access',
  created_at: '2026-01-01T00:00:00.000Z',
  revoked_at: null,
  active: true,
}

describe('SettingsPage API token revoke errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'products') {
        return queryResult({ data: [product], isLoading: false, error: null })
      }
      if (key === 'api-tokens') {
        return queryResult({ data: [activeToken], isLoading: false, error: null })
      }
      return queryResult({ data: undefined, isLoading: false, error: null })
    })
  })

  it('surfaces revoke mutation failures via toast.error', () => {
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      if ((options as { mutationFn?: unknown }).mutationFn === revokeApiToken) {
        capturedOnError = (options as { onError?: (err: unknown) => void }).onError
        return mutationResult({})
      }
      return mutationResult({})
    })

    renderToStaticMarkup(<SettingsPage />)
    capturedOnError?.(new Error('Token already revoked'))

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Token already revoked')
  })

  it('labels setup commands as the full production rollout workflow', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))

    const markup = renderToStaticMarkup(<SettingsPage />)

    expect(markup).toContain(
      'Run these commands for Cloudflare resources, production config, sequence sync, lead magnet checks, and deploy:',
    )
    expect(markup).toContain(
      'pnpm seq access-token-template --out dist/access-service-tokens.template.json',
    )
    expect(markup).toContain(
      'Fill missing secrets and Access token templates with real production values before validating.',
    )
    expect(markup).toContain('Deploy production')
    expect(markup).not.toContain('Run these wrangler commands to provision resources:')
  })

  it('shows empty states for both product-backed settings tables', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'products') {
        return queryResult({ data: [], isLoading: false, error: null })
      }
      if (key === 'api-tokens') {
        return queryResult({ data: [], isLoading: false, error: null })
      }
      return queryResult({ data: undefined, isLoading: false, error: null })
    })

    const markup = renderToStaticMarkup(<SettingsPage />)

    expect(markup).toContain('Product API Tokens')
    expect(markup).toContain('Resend Configuration')
    expect(markup.match(/No products configured\./g)).toHaveLength(2)
  })

  it('does not render generic Cloudflare root links for observability targets', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))

    const markup = renderToStaticMarkup(<SettingsPage />)

    expect(markup).toContain('Workers Observability URL not configured')
    expect(markup).toContain('Analytics Engine Explorer URL not configured')
    expect(markup).not.toContain('href="https://dash.cloudflare.com/"')
  })

  it('renders configured observability links directly', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))
    const env = import.meta.env as Record<string, string | undefined>
    const previousWorkersUrl = env.VITE_CF_WORKERS_OBSERVABILITY_URL
    const previousAnalyticsUrl = env.VITE_CF_ANALYTICS_ENGINE_URL
    env.VITE_CF_WORKERS_OBSERVABILITY_URL =
      'https://dash.cloudflare.com/workers/services/view/sequencer'
    env.VITE_CF_ANALYTICS_ENGINE_URL =
      'https://dash.cloudflare.com/analytics-engine/datasets/sequencer_metrics'

    try {
      const markup = renderToStaticMarkup(<SettingsPage />)

      expect(markup).toContain('href="https://dash.cloudflare.com/workers/services/view/sequencer"')
      expect(markup).toContain(
        'href="https://dash.cloudflare.com/analytics-engine/datasets/sequencer_metrics"',
      )
      expect(markup).not.toContain('Workers Observability URL not configured')
      expect(markup).not.toContain('Analytics Engine Explorer URL not configured')
    } finally {
      env.VITE_CF_WORKERS_OBSERVABILITY_URL = previousWorkersUrl
      env.VITE_CF_ANALYTICS_ENGINE_URL = previousAnalyticsUrl
    }
  })

  it('keeps service-token setup available when the token list fails to load', () => {
    mockUseMutation.mockReturnValue(mutationResult({}))
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'products') {
        return queryResult({ data: [product], isLoading: false, error: null })
      }
      if (key === 'api-tokens') {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: new Error('token list unavailable'),
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({ data: undefined, isLoading: false, error: null })
    })

    const markup = renderToStaticMarkup(<SettingsPage />)

    expect(markup).toContain('Failed to load API tokens')
    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('Setup Token')
  })
})
