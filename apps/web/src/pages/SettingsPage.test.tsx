import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revokeApiToken } from '../lib/api'
import type { ApiTokenRow, ProductRow } from '../lib/types'
import {
  canSubmitTokenMapping,
  filterSetupCommands,
  initialTokenDialogFormState,
  SETUP_COMMANDS,
  SettingsPage,
  tokenDialogFormReducer,
} from './SettingsPage'

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

const product2: ProductRow = {
  id: 'product_2',
  slug: 'floriva-web',
  name: 'Floriva',
  brand_color: '#abcdef',
  default_from_email: 'support@floriva.app',
  default_reply_to: 'support@floriva.app',
  resend_api_key_secret_name: 'RESEND_API_KEY_FLORIVA_WEB',
  suppression_scope: 'product',
  firewall_partner_id: 'product_1',
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
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

const revokedToken: ApiTokenRow = {
  id: 'token_2',
  product_id: product.id,
  product_slug: product.slug,
  product_name: product.name,
  label: 'Old token',
  access_service_token_id: '11111111111111111111111111111111.access',
  created_at: '2025-12-01T00:00:00.000Z',
  revoked_at: '2026-01-01T00:00:00.000Z',
  active: false,
}

function setupDefaultQueries(overrides?: {
  products?: ProductRow[]
  tokens?: ApiTokenRow[]
  productsError?: Error
  tokensError?: Error
  productsLoading?: boolean
  tokensLoading?: boolean
}) {
  mockUseQuery.mockImplementation((options) => {
    const key = (options as { queryKey: string[] }).queryKey[0]
    if (key === 'products') {
      if (overrides?.productsLoading) {
        return queryResult({ data: undefined, isLoading: true, error: null })
      }
      if (overrides?.productsError) {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: overrides.productsError,
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({
        data: overrides?.products ?? [product],
        isLoading: false,
        error: null,
      })
    }
    if (key === 'api-tokens') {
      if (overrides?.tokensLoading) {
        return queryResult({ data: undefined, isLoading: true, error: null })
      }
      if (overrides?.tokensError) {
        return queryResult({
          data: undefined,
          isLoading: false,
          error: overrides.tokensError,
          refetch: vi.fn(),
          isFetching: false,
        })
      }
      return queryResult({
        data: overrides?.tokens ?? [activeToken],
        isLoading: false,
        error: null,
      })
    }
    return queryResult({ data: undefined, isLoading: false, error: null })
  })
}

describe('tokenDialogFormReducer', () => {
  it('initial state is correct', () => {
    expect(initialTokenDialogFormState).toEqual({
      label: '',
      accessServiceTokenId: '',
      submitError: null,
    })
  })

  it('setLabel updates label', () => {
    const state = tokenDialogFormReducer(initialTokenDialogFormState, {
      type: 'setLabel',
      value: 'my-token',
    })
    expect(state.label).toBe('my-token')
  })

  it('setAccessServiceTokenId updates accessServiceTokenId', () => {
    const state = tokenDialogFormReducer(initialTokenDialogFormState, {
      type: 'setAccessServiceTokenId',
      value: 'abc123.access',
    })
    expect(state.accessServiceTokenId).toBe('abc123.access')
  })

  it('dialogOpened clears submitError but preserves other fields', () => {
    const state = {
      label: 'test',
      accessServiceTokenId: 'abc.access',
      submitError: 'some error',
    }
    const result = tokenDialogFormReducer(state, { type: 'dialogOpened' })
    expect(result.submitError).toBeNull()
    expect(result.label).toBe('test')
    expect(result.accessServiceTokenId).toBe('abc.access')
  })

  it('dialogClosed resets to initial state', () => {
    const state = {
      label: 'test',
      accessServiceTokenId: 'abc.access',
      submitError: 'error',
    }
    const result = tokenDialogFormReducer(state, { type: 'dialogClosed' })
    expect(result).toEqual(initialTokenDialogFormState)
  })

  it('submitSucceeded resets to initial state', () => {
    const state = {
      label: 'test',
      accessServiceTokenId: 'abc.access',
      submitError: null,
    }
    const result = tokenDialogFormReducer(state, { type: 'submitSucceeded' })
    expect(result).toEqual(initialTokenDialogFormState)
  })

  it('submitFailed sets submitError', () => {
    const result = tokenDialogFormReducer(initialTokenDialogFormState, {
      type: 'submitFailed',
      value: 'Token already revoked',
    })
    expect(result.submitError).toBe('Token already revoked')
  })
})

describe('canSubmitTokenMapping', () => {
  it('returns false when isPending is true', () => {
    expect(
      canSubmitTokenMapping({
        isPending: true,
        productId: 'prod_1',
        accessServiceTokenId: '00000000000000000000000000000000.access',
      }),
    ).toBe(false)
  })

  it('returns false when productId is empty', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: '',
        accessServiceTokenId: '00000000000000000000000000000000.access',
      }),
    ).toBe(false)
  })

  it('returns false when accessServiceTokenId does not match pattern', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_1',
        accessServiceTokenId: 'invalid-id',
      }),
    ).toBe(false)
  })

  it('returns false for a token id that is too short', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_1',
        accessServiceTokenId: '0000000000000000000000000000000.access', // 31 chars
      }),
    ).toBe(false)
  })

  it('returns true for valid inputs', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_1',
        accessServiceTokenId: '00000000000000000000000000000000.access',
      }),
    ).toBe(true)
  })

  it('returns true for uppercase token id', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_1',
        accessServiceTokenId: 'ABCDEF0123456789ABCDEF0123456789.access',
      }),
    ).toBe(true)
  })

  it('returns true for token id with leading/trailing whitespace', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_1',
        accessServiceTokenId: '  00000000000000000000000000000000.access  ',
      }),
    ).toBe(true)
  })
})

describe('filterSetupCommands', () => {
  it('returns every item when the search is empty or whitespace', () => {
    expect(filterSetupCommands(SETUP_COMMANDS, '')).toHaveLength(SETUP_COMMANDS.length)
    expect(filterSetupCommands(SETUP_COMMANDS, '   ')).toHaveLength(SETUP_COMMANDS.length)
  })

  it('matches on the command text', () => {
    const result = filterSetupCommands(SETUP_COMMANDS, 'deploy:prod')
    expect(result.some((item) => item.cmd === 'pnpm deploy:prod')).toBe(true)
    expect(
      result.every(
        (item) =>
          `${item.label} ${item.cmd ?? ''}`.toLowerCase().includes('deploy:prod') ||
          `${item.label}`.toLowerCase().includes('deploy:prod'),
      ),
    ).toBe(true)
  })

  it('matches on the label case-insensitively', () => {
    const result = filterSetupCommands(SETUP_COMMANDS, 'CREATE D1')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Create D1 database')
  })

  it('matches on a note for note-only items', () => {
    const result = filterSetupCommands(SETUP_COMMANDS, 'real production values')
    expect(result.some((item) => item.note?.includes('real production values'))).toBe(true)
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterSetupCommands(SETUP_COMMANDS, 'zzzznomatch')).toHaveLength(0)
  })
})

describe('SettingsPage loading states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue(mutationResult({}))
  })

  it('renders loading skeleton when products are loading', () => {
    setupDefaultQueries({ productsLoading: true })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Settings')
    expect(markup).toContain('Product API Tokens')
    expect(markup).toContain('Resend Configuration')
  })

  it('renders loading skeleton for tokens when tokens are loading but products are loaded', () => {
    setupDefaultQueries({ tokensLoading: true })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('CAMAudit')
  })

  it('renders products error with retry button', () => {
    setupDefaultQueries({ productsError: new Error('products unavailable') })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Failed to load products')
    expect(markup).toContain('products unavailable')
  })

  it('renders resend config error when products fail to load', () => {
    setupDefaultQueries({ productsError: new Error('db error') })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('We could not load your Resend setup.')
  })
})

describe('SettingsPage success states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue(mutationResult({}))
  })

  it('renders product name and slug in the tokens table', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('camaudit')
  })

  it('renders active token details including access service token id', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('00000000000000000000000000000000.access')
    expect(markup).toContain('Production token')
  })

  it('renders revoked token with revoked date', () => {
    setupDefaultQueries({ tokens: [activeToken, revokedToken] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Revoked')
  })

  it('shows table skeleton when tokens are still loading', () => {
    setupDefaultQueries({ tokensLoading: true })
    const markup = renderToStaticMarkup(<SettingsPage />)
    // TableSkeleton renders when tokensLoading=true
    expect(markup).toContain('animate-pulse')
    // Products should still be shown in Resend config
    expect(markup).toContain('founder@camaudit.io')
  })

  it('shows no active token warning badge when no active tokens', () => {
    setupDefaultQueries({ tokens: [revokedToken] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('No active token')
  })

  it('shows active count badge when product has active token', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('1 active')
  })

  it('shows Setup Token button for each product', () => {
    setupDefaultQueries({ products: [product, product2] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    const count = (markup.match(/Setup Token/g) ?? []).length
    expect(count).toBe(2)
  })

  it('shows revoke button for active tokens', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Revoke')
  })

  it('shows ProductTokenDetails dash when no tokens for a product', () => {
    setupDefaultQueries({ products: [product2], tokens: [] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Floriva')
  })

  it('renders resend config table with from email and secret name', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('founder@camaudit.io')
    expect(markup).toContain('RESEND_API_KEY_CAMAUDIT')
  })

  it('shows empty state for products in tokens table', () => {
    setupDefaultQueries({ products: [] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup.match(/No products configured\./g)).toHaveLength(2)
  })

  it('renders all Cloudflare setup commands', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('pnpm exec wrangler d1 create sequencer-db')
    expect(markup).toContain('pnpm exec wrangler kv namespace create SUPPRESSIONS')
    expect(markup).toContain('pnpm exec wrangler kv namespace create SESSIONS')
    expect(markup).toContain('pnpm exec wrangler r2 bucket create sequencer-assets')
    expect(markup).toContain('pnpm exec wrangler r2 bucket create sequencer-logs')
    expect(markup).toContain('pnpm exec wrangler queues create events-queue')
    expect(markup).toContain('pnpm exec wrangler queues create dead-letter-queue')
    expect(markup).toContain('pnpm deploy:prod')
  })

  it('keeps the Cloudflare setup commands collapsed by default behind a disclosure', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    // The card header stays visible as the disclosure trigger...
    expect(markup).toContain('Cloudflare Setup Commands')
    // ...but the command list region starts in the closed state.
    expect(markup).toContain('data-state="closed"')
  })

  it('renders the seq access-token-template command', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain(
      'pnpm seq access-token-template --out dist/access-service-tokens.template.json',
    )
  })

  it('renders observability section headers', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Observability')
    expect(markup).toContain('Workers Observability URL not configured')
    expect(markup).toContain('Analytics Engine Explorer URL not configured')
  })

  it('renders configured observability links when env vars are set', () => {
    setupDefaultQueries()
    const env = import.meta.env as Record<string, string | undefined>
    const prevWorkers = env.VITE_CF_WORKERS_OBSERVABILITY_URL
    const prevAnalytics = env.VITE_CF_ANALYTICS_ENGINE_URL
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
      env.VITE_CF_WORKERS_OBSERVABILITY_URL = prevWorkers
      env.VITE_CF_ANALYTICS_ENGINE_URL = prevAnalytics
    }
  })

  it('does not render cloudflare root link when observability unconfigured', () => {
    setupDefaultQueries()
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).not.toContain('href="https://dash.cloudflare.com/"')
  })
})

describe('SettingsPage tokens error state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue(mutationResult({}))
  })

  it('shows tokens error while still rendering product rows', () => {
    setupDefaultQueries({ tokensError: new Error('token list unavailable') })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Failed to load API tokens')
    expect(markup).toContain('token list unavailable')
    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('Setup Token')
  })

  it('tokens error shows Unavailable badge in token status column', () => {
    setupDefaultQueries({ tokensError: new Error('timeout') })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Unavailable')
    expect(markup).not.toContain('1 active')
  })
})

describe('SettingsPage revoke mutation callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    setupDefaultQueries()
  })

  it('surfaces revoke mutation failures via toast.error', async () => {
    const { toast } = await import('sonner')
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      if ((options as { mutationFn?: unknown }).mutationFn === revokeApiToken) {
        capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      }
      return mutationResult({})
    })

    renderToStaticMarkup(<SettingsPage />)
    capturedOnError?.(new Error('Token already revoked'))

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Token already revoked')
  })

  it('surfaces revoke mutation failures with fallback message for non-Error', async () => {
    const { toast } = await import('sonner')
    let capturedOnError: ((err: unknown) => void) | undefined
    mockUseMutation.mockImplementation((options) => {
      if ((options as { mutationFn?: unknown }).mutationFn === revokeApiToken) {
        capturedOnError = (options as { onError?: (err: unknown) => void }).onError
      }
      return mutationResult({})
    })

    renderToStaticMarkup(<SettingsPage />)
    capturedOnError?.('some string error')

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to revoke token')
  })
})

describe('SettingsPage Cloudflare setup section copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue(mutationResult({}))
    setupDefaultQueries()
  })

  it('labels setup commands as the full production rollout workflow', () => {
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain(
      'Run these commands for Cloudflare resources, production config, sequence sync, lead magnet checks, and deploy:',
    )
    expect(markup).toContain(
      'Fill missing secrets and Access token templates with real production values before validating.',
    )
    expect(markup).toContain('Deploy production')
    expect(markup).not.toContain('Run these wrangler commands to provision resources:')
  })

  it('renders the seq sync command', () => {
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('pnpm seq sync --remote')
    expect(markup).toContain('pnpm seq compile')
  })

  it('renders lead magnet SQL generation command', () => {
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('pnpm seq lead-magnet-sql --out dist/required-lead-magnets.sql')
  })

  it('renders apply lead magnet rows command', () => {
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain(
      'wrangler d1 execute sequencer-db --remote --file ./dist/required-lead-magnets.sql',
    )
  })
})

describe('SettingsPage multiple products', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearObservabilityEnv()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseMutation.mockReturnValue(mutationResult({}))
  })

  it('renders multiple product rows in the tokens table', () => {
    setupDefaultQueries({ products: [product, product2], tokens: [activeToken] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('Floriva')
  })

  it('renders multiple product rows in the resend config table', () => {
    setupDefaultQueries({ products: [product, product2] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('founder@camaudit.io')
    expect(markup).toContain('support@floriva.app')
    expect(markup).toContain('RESEND_API_KEY_FLORIVA_WEB')
  })

  it('associates tokens with the correct product in the table', () => {
    const prod2Token: ApiTokenRow = {
      ...activeToken,
      id: 'token_prod2',
      product_id: product2.id,
      product_slug: product2.slug,
      product_name: product2.name,
      label: 'Floriva prod token',
      access_service_token_id: 'aabbccddeeff00112233445566778899.access',
    }
    setupDefaultQueries({ products: [product, product2], tokens: [activeToken, prod2Token] })
    const markup = renderToStaticMarkup(<SettingsPage />)
    expect(markup).toContain('Production token')
    expect(markup).toContain('Floriva prod token')
  })
})
