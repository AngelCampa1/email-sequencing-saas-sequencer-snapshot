import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  BarChart3,
  ChevronDown,
  Copy,
  ExternalLink,
  KeyRound,
  Search,
  SearchX,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { useMemo, useReducer, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { QueryError } from '../components/ui/query-error'
import { BulkActionBar, RowCheckbox, SelectAllCheckbox } from '../components/ui/row-select'
import { Skeleton, TableSkeleton } from '../components/ui/skeleton'
import { Spinner } from '../components/ui/spinner'
import { TableToolbar } from '../components/ui/toolbar'
import { createApiToken, getApiTokens, getProducts, revokeApiToken } from '../lib/api'
import { EM_DASH, formatDate } from '../lib/dates'
import { queryKeys } from '../lib/queryKeys'
import type { ApiTokenRow, ProductRow } from '../lib/types'
import { useRowSelection } from '../lib/use-row-selection'

const accessClientIdPattern = /^[0-9a-f]{32}\.access$/i
const accessClientIdPatternAttribute = accessClientIdPattern.source

type TokenDialogFormState = {
  label: string
  accessServiceTokenId: string
  submitError: string | null
}

type TokenDialogFormAction =
  | { type: 'setLabel'; value: string }
  | { type: 'setAccessServiceTokenId'; value: string }
  | { type: 'dialogOpened' }
  | { type: 'dialogClosed' }
  | { type: 'submitSucceeded' }
  | { type: 'submitFailed'; value: string }

export const initialTokenDialogFormState: TokenDialogFormState = {
  label: '',
  accessServiceTokenId: '',
  submitError: null,
}

function optionalEnvUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getObservabilityLinks() {
  return [
    {
      label: 'Workers Observability',
      href: optionalEnvUrl(import.meta.env.VITE_CF_WORKERS_OBSERVABILITY_URL),
    },
    {
      label: 'Analytics Engine Explorer',
      href: optionalEnvUrl(import.meta.env.VITE_CF_ANALYTICS_ENGINE_URL),
    },
  ]
}

export type SetupCommandItem = {
  label: string
  cmd?: string
  note?: string
}

export const SETUP_COMMANDS: SetupCommandItem[] = [
  { label: 'Create D1 database', cmd: 'pnpm exec wrangler d1 create sequencer-db' },
  {
    label: 'Create KV - Suppressions',
    cmd: 'pnpm exec wrangler kv namespace create SUPPRESSIONS',
  },
  {
    label: 'Create KV - Sessions',
    cmd: 'pnpm exec wrangler kv namespace create SESSIONS',
  },
  {
    label: 'Create R2 - Assets',
    cmd: 'pnpm exec wrangler r2 bucket create sequencer-assets',
  },
  {
    label: 'Create R2 - Logs',
    cmd: 'pnpm exec wrangler r2 bucket create sequencer-logs',
  },
  {
    label: 'Create Queue - Events',
    cmd: 'pnpm exec wrangler queues create events-queue',
  },
  {
    label: 'Create Queue - DLQ',
    cmd: 'pnpm exec wrangler queues create dead-letter-queue',
  },
  {
    label: 'Generate missing secret template',
    cmd: 'pnpm seq secret-template --missing-remote --out dist/missing-production-secrets.template.json',
  },
  {
    label: 'Generate Access token template',
    cmd: 'pnpm seq access-token-template --out dist/access-service-tokens.template.json',
  },
  {
    label: 'Fill production values',
    note: 'Fill missing secrets and Access token templates with real production values before validating.',
  },
  {
    label: 'Validate production config',
    cmd: 'pnpm apply:prod-config:missing:dry-run',
  },
  {
    label: 'Generate lead magnet SQL',
    cmd: 'pnpm seq lead-magnet-sql --out dist/required-lead-magnets.sql',
  },
  {
    label: 'Generate lead magnet asset verification commands',
    cmd: 'pnpm seq lead-magnet-assets --out dist/required-lead-magnet-assets.ps1',
  },
  { label: 'Compile sequences', cmd: 'pnpm seq compile' },
  { label: 'Sync sequences', cmd: 'pnpm seq sync --remote' },
  {
    label: 'Verify lead magnet assets',
    note: 'Run dist/required-lead-magnet-assets.ps1 to verify the required product-owned R2 assets before applying the D1 rows.',
  },
  {
    label: 'Apply lead magnet rows',
    cmd: 'pnpm exec wrangler d1 execute sequencer-db --remote --file ./dist/required-lead-magnets.sql --config apps/api/wrangler.toml',
  },
  { label: 'Apply production config', cmd: 'pnpm apply:prod-config:missing' },
  { label: 'Deploy production', cmd: 'pnpm deploy:prod' },
]

export function filterSetupCommands(items: SetupCommandItem[], search: string): SetupCommandItem[] {
  const query = search.trim().toLowerCase()
  if (query === '') return items
  return items.filter((item) =>
    [item.label, item.cmd ?? '', item.note ?? ''].join(' ').toLowerCase().includes(query),
  )
}

export function canSubmitTokenMapping(input: {
  isPending: boolean
  productId: string
  accessServiceTokenId: string
}): boolean {
  return (
    !input.isPending &&
    input.productId !== '' &&
    accessClientIdPattern.test(input.accessServiceTokenId.trim())
  )
}

export function tokenDialogFormReducer(
  state: TokenDialogFormState,
  action: TokenDialogFormAction,
): TokenDialogFormState {
  switch (action.type) {
    case 'setLabel':
      return { ...state, label: action.value }
    case 'setAccessServiceTokenId':
      return { ...state, accessServiceTokenId: action.value }
    case 'dialogOpened':
      return { ...state, submitError: null }
    case 'dialogClosed':
    case 'submitSucceeded':
      return initialTokenDialogFormState
    case 'submitFailed':
      return { ...state, submitError: action.value }
  }
}

function TokenDialog({ product }: { product: ProductRow }) {
  const qc = useQueryClient()
  const labelInputId = `token-label-${product.id}`
  const accessClientIdInputId = `token-access-client-id-${product.id}`
  const accessClientIdErrorId = `${accessClientIdInputId}-error`
  const [open, setOpen] = useState(false)
  const [form, dispatchForm] = useReducer(tokenDialogFormReducer, initialTokenDialogFormState)
  const createMutation = useMutation({
    mutationFn: createApiToken,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.apiTokens() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Token mapping saved')
      setOpen(false)
      dispatchForm({ type: 'submitSucceeded' })
    },
    onError: (error) => {
      dispatchForm({
        type: 'submitFailed',
        value: error instanceof Error ? error.message : 'Failed to save token mapping',
      })
    },
  })

  const trimmedAccessId = form.accessServiceTokenId.trim()
  const hasAccessClientIdError =
    trimmedAccessId !== '' && !accessClientIdPattern.test(trimmedAccessId)
  const canSubmit = canSubmitTokenMapping({
    isPending: createMutation.isPending,
    productId: product.id,
    accessServiceTokenId: form.accessServiceTokenId,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    dispatchForm({ type: 'dialogOpened' })
    if (!canSubmit) return
    createMutation.mutate({
      product_id: product.id,
      label: form.label.trim() || undefined,
      access_service_token_id: trimmedAccessId,
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      dispatchForm({ type: 'dialogOpened' })
    } else {
      dispatchForm({ type: 'dialogClosed' })
    }
    setOpen(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound size={12} /> Setup Token
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Service Token - Cloudflare Access"
        description={`Token for ${product.name}`}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Service tokens are managed in <strong>Cloudflare Zero Trust</strong>. The product app
              stores the client id and secret; Sequencer stores the verified client id in D1.
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-500">
              <li>Go to Cloudflare Zero Trust - Access - Service Auth</li>
              <li>
                Click <strong>Create Service Token</strong>
              </li>
              <li>
                Name it{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  {product.slug}-service-token
                </code>
              </li>
              <li>Store the Client ID and Client Secret in the product app</li>
              <li>
                Paste the Client ID ending in{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">.access</code>{' '}
                below
              </li>
              <li>
                Product calls send{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  CF-Access-Client-Id
                </code>{' '}
                and{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  CF-Access-Client-Secret
                </code>
                ; Cloudflare Access must protect{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                  /api/v1/*
                </code>
              </li>
            </ol>
            <a
              href="https://one.dash.cloudflare.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs mt-1"
            >
              Open Cloudflare Zero Trust <ExternalLink size={11} />
            </a>
          </div>

          <div className="space-y-1">
            <label htmlFor={labelInputId} className="text-xs font-medium text-slate-700">
              Label
            </label>
            <Input
              id={labelInputId}
              data-autofocus
              value={form.label}
              onChange={(e) => dispatchForm({ type: 'setLabel', value: e.target.value })}
              placeholder={`${product.slug}-service-token`}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={accessClientIdInputId} className="text-xs font-medium text-slate-700">
              Access Client ID *
            </label>
            <Input
              id={accessClientIdInputId}
              value={form.accessServiceTokenId}
              onChange={(e) =>
                dispatchForm({ type: 'setAccessServiceTokenId', value: e.target.value })
              }
              placeholder="00000000000000000000000000000000.access"
              required
              aria-required="true"
              pattern={accessClientIdPatternAttribute}
              aria-invalid={hasAccessClientIdError}
              aria-describedby={hasAccessClientIdError ? accessClientIdErrorId : undefined}
              spellCheck={false}
              className="font-mono"
            />
            {hasAccessClientIdError && (
              <p id={accessClientIdErrorId} className="text-xs text-red-600">
                Use the 32-character Cloudflare Access client id ending in .access.
              </p>
            )}
          </div>
          {form.submitError && (
            <p role="alert" className="text-sm text-red-600">
              Failed to save token mapping: {form.submitError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {createMutation.isPending ? (
                <>
                  <Spinner /> Saving
                </>
              ) : (
                'Save Mapping'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TokenStatus({
  tokens,
  unavailable = false,
}: {
  tokens: ApiTokenRow[]
  unavailable?: boolean
}) {
  if (unavailable) {
    return <Badge variant="outline">Unavailable</Badge>
  }

  const active = tokens.filter((token) => token.active)
  if (active.length === 0) {
    return <Badge variant="warning">No active token</Badge>
  }
  return (
    <Badge variant="secondary">
      <ShieldCheck size={11} /> {active.length} active
    </Badge>
  )
}

function ProductTokenDetails({ tokens }: { tokens: ApiTokenRow[] }) {
  const sorted = [...tokens].sort(
    (a, b) => Number(b.active) - Number(a.active) || b.created_at.localeCompare(a.created_at),
  )
  if (sorted.length === 0) {
    return <span className="text-xs text-slate-500">{EM_DASH}</span>
  }
  return (
    <div className="space-y-1">
      {sorted.map((token) => (
        <div key={token.id} className="flex flex-col gap-0.5">
          <span className="font-medium text-slate-700">{token.label}</span>
          <span className="font-mono text-[11px] text-slate-500 break-all">
            {token.access_service_token_id}
          </span>
          {token.revoked_at && (
            <span className="text-[11px] text-slate-500">
              Revoked {formatDate(token.revoked_at)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function RevokeTokenButton({ token }: { token: ApiTokenRow }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.apiTokens() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success(`Token "${token.label}" revoked`)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke token')
    },
  })

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            title={`Revoke ${token.label}`}
          >
            {mutation.isPending ? <Spinner size={12} /> : <Ban size={12} />}{' '}
            {mutation.isPending ? 'Revoking' : 'Revoke'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          title={`Revoke ${token.label}?`}
          description={`Product API calls for ${token.product_name} using this Access client id will stop working.`}
        >
          <div className="flex justify-end gap-2 pt-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => mutation.mutate(token.id)}
              >
                Revoke
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CloudflareSetupCommands() {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => filterSetupCommands(SETUP_COMMANDS, search), [search])
  // Only items that carry a runnable command can be selected and copied.
  const copyableLabels = useMemo(
    () => filtered.filter((item) => item.cmd).map((item) => item.label),
    [filtered],
  )
  const sel = useRowSelection<string>(copyableLabels)

  async function handleCopySelected() {
    const commands = filtered
      .filter((item) => item.cmd && sel.isSelected(item.label))
      .map((item) => item.cmd as string)
    if (commands.length === 0) return
    try {
      await navigator.clipboard.writeText(commands.join('\n'))
    } catch {
      toast.error('We could not copy these commands.')
      return
    }
    toast.success(`Copied ${commands.length} commands`)
    sel.clear()
  }

  return (
    <CardContent className="space-y-3">
      <p className="text-sm text-slate-500">
        Run these commands for Cloudflare resources, production config, sequence sync, lead magnet
        checks, and deploy:
      </p>

      <TableToolbar>
        <div className="relative max-w-sm">
          <label htmlFor="settings-search" className="sr-only">
            Search settings
          </label>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id="settings-search"
            aria-label="Search settings"
            placeholder="Search commands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {copyableLabels.length > 0 && (
          <label
            htmlFor="select-all-commands"
            className="flex items-center gap-2 text-xs text-slate-500"
          >
            <SelectAllCheckbox
              id="select-all-commands"
              checked={sel.allSelected}
              indeterminate={sel.someSelected}
              onChange={() => sel.toggleAll()}
              aria-label="Select all commands"
            />
            Select all commands
          </label>
        )}
      </TableToolbar>

      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <SearchX size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-600">No matches</p>
          <p className="text-xs text-slate-500 mt-1">Try a different search.</p>
        </div>
      ) : (
        filtered.map(({ label, cmd, note }) => (
          <div key={label} className="flex items-start gap-2">
            {cmd ? (
              <RowCheckbox
                checked={sel.isSelected(label)}
                onChange={() => sel.toggle(label)}
                aria-label={`Select ${label}`}
              />
            ) : (
              <span className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              {cmd ? (
                <pre className="rounded bg-slate-900 text-emerald-400 px-4 py-2.5 text-xs font-mono overflow-x-auto">
                  {cmd}
                </pre>
              ) : (
                <p className="rounded border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                  {note}
                </p>
              )}
            </div>
          </div>
        ))
      )}

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <Button size="sm" onClick={() => void handleCopySelected()}>
          <Copy size={14} /> Copy commands
        </Button>
      </BulkActionBar>
    </CardContent>
  )
}

export function SettingsPage() {
  const observabilityLinks = getObservabilityLinks()
  const {
    data: products,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.products(),
    queryFn: getProducts,
  })
  const {
    data: apiTokens,
    isLoading: tokensLoading,
    error: tokensError,
    refetch: refetchTokens,
    isFetching: tokensFetching,
  } = useQuery({
    queryKey: queryKeys.apiTokens(),
    queryFn: getApiTokens,
  })
  const tokenRows = tokensError ? [] : (apiTokens ?? [])
  const tokenStatusUnavailable = Boolean(tokensError) || tokensLoading

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Platform configuration and reference</p>
      </div>

      {/* Product API Tokens */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={14} className="text-slate-500" /> Product API Tokens
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5">
              <Skeleton className="h-24" />
            </div>
          ) : error ? (
            <div className="p-5">
              <QueryError
                title="Failed to load products"
                error={error}
                onRetry={() => void refetch()}
                isRetrying={isFetching}
              />
            </div>
          ) : !products || products.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No products configured.</p>
          ) : (
            <div>
              {tokensLoading ? (
                <div className="p-5">
                  <TableSkeleton rows={products.length || 3} cols={5} />
                </div>
              ) : (
                <>
                  {tokensError && (
                    <div className="p-5 pb-0">
                      <QueryError
                        title="Failed to load API tokens"
                        error={tokensError}
                        onRetry={() => void refetchTokens()}
                        isRetrying={tokensFetching}
                      />
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" aria-label="Product API tokens">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                            Product
                          </th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                            Slug
                          </th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                            Status
                          </th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                            Mappings
                          </th>
                          <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                            Access
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((p) => {
                          const productTokens = tokenRows.filter(
                            (token) => token.product_id === p.id,
                          )
                          const activeTokens = productTokens.filter((token) => token.active)
                          return (
                            <tr key={p.id} className="border-b border-slate-50 align-top">
                              <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                              <td className="px-5 py-3 font-mono text-xs text-slate-500">
                                {p.slug}
                              </td>
                              <td className="px-5 py-3">
                                <TokenStatus
                                  tokens={productTokens}
                                  unavailable={tokenStatusUnavailable}
                                />
                              </td>
                              <td className="px-5 py-3 max-w-md">
                                <ProductTokenDetails tokens={productTokens} />
                              </td>
                              <td className="px-5 py-3">
                                <div className="flex justify-end gap-2">
                                  {activeTokens.map((token) => (
                                    <RevokeTokenButton key={token.id} token={token} />
                                  ))}
                                  <TokenDialog product={p} />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resend Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server size={14} className="text-slate-500" /> Resend Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5">
              <Skeleton className="h-24" />
            </div>
          ) : error ? (
            <div className="p-5">
              <QueryError
                title="We could not load your Resend setup."
                error={error}
                onRetry={() => void refetch()}
                isRetrying={isFetching}
              />
            </div>
          ) : !products || products.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No products configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Resend configuration">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Product
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      From Email
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Secret Name
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(products ?? []).map((p) => (
                    <tr key={p.id} className="border-b border-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">
                        {p.default_from_email}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="outline" className="font-mono text-xs">
                          {p.resend_api_key_secret_name}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Observability */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 size={14} className="text-slate-500" /> Observability
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-slate-500">
            Workers metrics and Analytics Engine are available in the Cloudflare dashboard.
          </p>
          <div className="flex flex-wrap gap-3">
            {observabilityLinks.map((link) =>
              link.href ? (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
                >
                  {link.label} <ExternalLink size={12} />
                </a>
              ) : (
                <span
                  key={link.label}
                  aria-disabled="true"
                  className="inline-flex items-center text-slate-400 text-sm"
                >
                  {link.label} URL not configured
                </span>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cloudflare Setup */}
      <Card>
        <Collapsible>
          <CardHeader className="p-0">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-5 py-4 text-left transition-colors hover:bg-slate-50">
              <CardTitle className="flex items-center gap-2">
                <Terminal size={14} className="text-slate-500" /> Cloudflare Setup Commands
              </CardTitle>
              <ChevronDown
                size={16}
                className="shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <CloudflareSetupCommands />
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  )
}
