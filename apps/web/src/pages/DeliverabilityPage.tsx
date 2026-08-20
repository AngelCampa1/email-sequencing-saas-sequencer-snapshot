import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Inbox, Send, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { QueryError } from '../components/ui/query-error'
import { Select, SelectItem } from '../components/ui/select'
import { TableSkeleton } from '../components/ui/skeleton'
import { Sparkline } from '../components/ui/sparkline'
import { Spinner } from '../components/ui/spinner'
import { getDeliverability, getProducts, updateInstantlyCampaign } from '../lib/api'
import { EM_DASH, formatDate } from '../lib/dates'
import { humanizeToken } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { DeliverabilityData } from '../lib/types'

function pct(n: number, total: number) {
  if (total === 0) return '0.00%'
  return `${((n / total) * 100).toFixed(2)}%`
}

type DomainRow = DeliverabilityData['domains'][number]

// The deliverability response has no per-domain history array — each `domains[]`
// entry is a single domain/day snapshot, and a domain can appear on multiple
// dates. We derive a real bounce-rate trend per domain by grouping its rows,
// ordering them oldest-to-newest by date, and taking bounced/sent per day.
// No data is invented; a domain seen on only one day yields a single point and
// renders the "—" placeholder instead of an empty sparkline.
function bounceRateSeriesByDomain(domains: DomainRow[]): Map<string, number[]> {
  const grouped = new Map<string, DomainRow[]>()
  for (const row of domains) {
    const list = grouped.get(row.domain)
    if (list) list.push(row)
    else grouped.set(row.domain, [row])
  }

  const series = new Map<string, number[]>()
  for (const [domain, rows] of grouped) {
    const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    series.set(
      domain,
      ordered.map((r) => (r.sent === 0 ? 0 : r.bounced / r.sent)),
    )
  }
  return series
}

function isCamauditDomain(domain: string) {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '')
  return normalized === 'camaudit.io' || normalized.endsWith('.camaudit.io')
}

function BounceCell({ bounced, sent }: { bounced: number; sent: number }) {
  const rate = sent === 0 ? 0 : bounced / sent
  const high = rate > 0.05
  const med = rate > 0.02
  return (
    <span
      className={high ? 'font-semibold text-red-600' : med ? 'text-amber-600' : 'text-slate-600'}
    >
      {pct(bounced, sent)}
    </span>
  )
}

function ComplaintCell({ complained, sent }: { complained: number; sent: number }) {
  const rate = sent === 0 ? 0 : complained / sent
  const high = rate > 0.001
  return (
    <span className={high ? 'font-semibold text-red-600' : 'text-slate-600'}>
      {pct(complained, sent)}
    </span>
  )
}

function TrendCell({ domain, values }: { domain: string; values: number[] }) {
  // The Sparkline primitive renders an empty polyline for <2 points, so guard
  // single-day domains with a muted dash rather than an empty SVG.
  if (values.length < 2) {
    return <span className="text-slate-400">{EM_DASH}</span>
  }
  return (
    <Sparkline
      values={values}
      width={80}
      height={20}
      strokeClassName="text-blue-500"
      aria-label={`${values.length}-day bounce-rate trend for ${domain}`}
    />
  )
}

// Radix Select forbids empty-string <SelectItem> values (it reserves the empty
// string to clear the selection and show the placeholder), so the "Unassigned"
// option uses a non-empty sentinel that maps back to null on submit.
const UNASSIGNED_VALUE = '__unassigned__'

interface AssignCampaignDialogProps {
  campaign: {
    id: string
    name: string
    product_id?: string | null
  }
  products: Array<{ id: string; slug: string; name: string }>
}

function AssignCampaignDialog({ campaign, products }: AssignCampaignDialogProps) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string>(
    campaign.product_id ?? UNASSIGNED_VALUE,
  )

  const assignMutation = useMutation({
    mutationFn: ({ id, productId }: { id: string; productId: string | null }) =>
      updateInstantlyCampaign(id, { product_id: productId }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.deliverability() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Campaign saved')
      setOpen(false)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update campaign')
    },
  })

  function handleSubmit() {
    assignMutation.mutate({
      id: campaign.id,
      productId: selectedProductId === UNASSIGNED_VALUE ? null : selectedProductId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Assign campaign to product"
        description="Pick which product this campaign belongs to."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="campaign-product" className="text-sm font-medium text-slate-700">
              Product
            </label>
            <Select
              id="campaign-product"
              value={selectedProductId}
              onValueChange={setSelectedProductId}
              placeholder="Unassigned"
              className="w-full"
            >
              <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          {assignMutation.isError && (
            <p role="alert" className="text-sm text-red-600">
              We could not save this campaign:{' '}
              {assignMutation.error instanceof Error
                ? assignMutation.error.message
                : 'Please try again.'}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              type="button"
              onClick={handleSubmit}
              disabled={assignMutation.isPending}
            >
              {assignMutation.isPending ? (
                <>
                  <Spinner /> Saving
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DeliverabilityPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.deliverability(),
    queryFn: getDeliverability,
  })
  const { data: products } = useQuery({
    queryKey: queryKeys.products(),
    queryFn: getProducts,
  })

  const productMap = Object.fromEntries((products ?? []).map((p) => [p.id, p]))
  const camauditDomains = (data?.domains ?? []).filter((d) => isCamauditDomain(d.domain))
  const bounceTrends = bounceRateSeriesByDomain(data?.domains ?? [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Deliverability</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Domain health metrics and cold outreach stats
        </p>
      </div>

      {error ? (
        <QueryError
          title="We could not load your email health."
          error={error}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      ) : (
        <>
          {/* CAMAudit callout */}
          {camauditDomains.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex gap-3">
              <Zap size={18} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-900">Watch your new domain</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  This domain is new. Send slowly. Watch your bounce and spam rates.
                </p>
              </div>
            </div>
          )}

          {/* Warm - Resend domain health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap size={14} className="text-emerald-600" /> Warm Email (Resend) - Domain Health
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-5">
                  <TableSkeleton rows={5} cols={8} />
                </div>
              ) : !data || data.domains.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="No domain health yet"
                  description="This table fills in each day after you send emails."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Domain health metrics">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Domain
                        </th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Date
                        </th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                          Sent
                        </th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                          Delivered
                        </th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                          Bounce %
                        </th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                          Complaint %
                        </th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                          Opened
                        </th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Trend
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.domains.map((d) => (
                        <tr
                          key={d.id}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-5 py-3 font-mono text-xs text-slate-700">{d.domain}</td>
                          <td className="px-5 py-3 text-xs text-slate-500">{formatDate(d.date)}</td>
                          <td className="px-5 py-3 text-right text-slate-700">
                            {d.sent.toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-700">
                            {d.delivered.toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <BounceCell bounced={d.bounced} sent={d.sent} />
                          </td>
                          <td className="px-5 py-3 text-right">
                            <ComplaintCell complained={d.complained} sent={d.sent} />
                          </td>
                          <td className="px-5 py-3 text-right text-slate-600">
                            {d.opened.toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-left">
                            <TrendCell
                              domain={d.domain}
                              values={bounceTrends.get(d.domain) ?? []}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cold - Instantly campaigns */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity size={14} className="text-blue-600" /> Cold Outreach (Instantly) -
                Campaigns
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-5">
                  <TableSkeleton rows={4} cols={5} />
                </div>
              ) : !data || data.instantly_campaigns.length === 0 ? (
                <EmptyState
                  icon={Send}
                  title="No cold outreach campaigns yet"
                  description="We pull these from Instantly every hour. They show up here once they sync."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Instantly campaigns">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Campaign
                        </th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Product
                        </th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Status
                        </th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Synced
                        </th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.instantly_campaigns.map((c) => {
                        const assignedProduct = c.product_id ? productMap[c.product_id] : null
                        return (
                          <tr
                            key={c.id}
                            className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                          >
                            <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                            <td className="px-5 py-3 text-sm text-slate-500">
                              {assignedProduct ? (
                                <Badge variant="secondary">{assignedProduct.name}</Badge>
                              ) : (
                                <span className="text-slate-500">Unassigned</span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <Badge variant={c.status === 'active' ? 'success' : 'outline'}>
                                {humanizeToken(c.status)}
                              </Badge>
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-500">
                              {formatDate(c.synced_at)}
                            </td>
                            <td className="px-5 py-3">
                              <AssignCampaignDialog campaign={c} products={products ?? []} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
