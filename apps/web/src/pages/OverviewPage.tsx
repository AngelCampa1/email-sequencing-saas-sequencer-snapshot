import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, Flame, MailCheck, Snowflake, TrendingDown } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { QueryError } from '../components/ui/query-error'
import { Skeleton } from '../components/ui/skeleton'
import { getOverview } from '../lib/api'
import { productNameLabel, rotSequenceLabel, sequenceLabel } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'

export function OverviewPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.overview(),
    queryFn: getOverview,
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <QueryError
          title="We could not load your overview."
          error={error}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <QueryError
          title="We have no overview to show yet."
          error={new Error('The overview came back empty.')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    )
  }

  const stats = [
    {
      label: 'Emails Sent (7 days)',
      value: data.send_volume_7d.toLocaleString(),
      icon: MailCheck,
      sub:
        data.send_volume_30d === 0
          ? 'Waiting for the first send'
          : `${data.send_volume_30d.toLocaleString()} in the last 30 days`,
    },
    {
      label: 'Active Runs',
      value: data.active_runs.toLocaleString(),
      icon: Activity,
      sub: data.active_runs === 0 ? 'No one in a sequence yet' : 'People in a sequence right now',
    },
    {
      label: 'Unsubscribe Rate (7 days)',
      value: `${(data.unsub_rate_7d * 100).toFixed(2)}%`,
      icon: TrendingDown,
      sub: data.unsub_rate_7d > 0.02 ? 'Higher than we like' : 'Looking healthy',
    },
    {
      label: 'Stale Sequences',
      value: data.rot_sequences.length.toLocaleString(),
      icon: AlertTriangle,
      sub:
        data.rot_sequences.length > 0
          ? `${data.rot_sequences.length} sequence${data.rot_sequences.length > 1 ? 's' : ''} with no recent sign-ups`
          : 'All sequences active',
      warn: data.rot_sequences.length > 0,
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">Real-time summary of your email sequences</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className={s.warn ? 'border-amber-300' : ''}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">
                    {s.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{s.value}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{s.sub}</p>
                </div>
                <span
                  className={`p-2 rounded-lg ${s.warn ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}`}
                >
                  <s.icon size={18} />
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rot sequences alert */}
      {data.rot_sequences.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {data.rot_sequences.length} sequence{data.rot_sequences.length > 1 ? 's' : ''} with no
              new sign-ups in the last 90 days
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.rot_sequences.map((slug) => (
                <Badge key={slug} variant="warning">
                  {rotSequenceLabel(slug)}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top sequences */}
      <Card>
        <CardHeader>
          <CardTitle>Top Active Sequences</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.top_sequences.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500 text-center">No active sequences yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Top active sequences">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Sequence
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Product
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                      Enrollments
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_sequences.map((s) => (
                    <tr
                      key={s.slug}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3 text-slate-700">
                        <Link
                          to={`/sequences?q=${encodeURIComponent(s.slug)}`}
                          className="text-blue-700 hover:underline"
                        >
                          {sequenceLabel(s.slug, s.product)}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="secondary">{productNameLabel(s.product)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {s.enrollments.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Warm vs Cold summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame size={14} className="text-emerald-600" /> Warm Email
            </CardTitle>
            <p className="text-xs text-slate-500">Sent through Resend</p>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Sent in the last 7 days</dt>
                <dd className="font-medium text-slate-900">
                  {data.warm_summary.total_sent_7d.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Avg bounce rate</dt>
                <dd
                  className={
                    data.warm_summary.avg_bounce_rate > 0.05
                      ? 'font-medium text-red-600'
                      : 'font-medium text-slate-900'
                  }
                >
                  {(data.warm_summary.avg_bounce_rate * 100).toFixed(2)}%
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Snowflake size={14} className="text-blue-600" /> Cold Outreach
            </CardTitle>
            <p className="text-xs text-slate-500">Sent through Instantly</p>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Campaigns</dt>
                <dd className="font-medium text-slate-900">
                  {data.cold_summary.total_campaigns.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Reply rate</dt>
                <dd className="font-medium text-slate-900">
                  {(data.cold_summary.reply_rate * 100).toFixed(2)}%
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
