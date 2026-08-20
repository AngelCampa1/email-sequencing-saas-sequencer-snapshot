import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Inbox, SearchX } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { ExportButton } from '../components/ui/data-export'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { QueryError } from '../components/ui/query-error'
import { Select, SelectItem } from '../components/ui/select'
import { TableSkeleton } from '../components/ui/skeleton'
import { TableToolbar } from '../components/ui/toolbar'
import { getAuditLog } from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { formatDateTime } from '../lib/dates'
import { auditActionLabel, auditTargetTypeLabel } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { AuditEntry } from '../lib/types'
import { hasAuditChanges } from './audit-row-accessibility'

const ALL_ACTIONS = '__all__'

const CSV_COLUMNS: CsvColumn<AuditEntry>[] = [
  { header: 'When', accessor: (row) => row.at },
  { header: 'Who', accessor: (row) => row.actor },
  { header: 'Action', accessor: (row) => auditActionLabel(row.action) },
  { header: 'Item type', accessor: (row) => auditTargetTypeLabel(row.target_type) },
  { header: 'Item id', accessor: (row) => row.target_id ?? null },
]

export function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const changesId = useId()
  const hasChanges = hasAuditChanges(entry)

  const toggleExpanded = () => {
    if (hasChanges) setExpanded((e) => !e)
  }

  return (
    <>
      <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
        <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
          {formatDateTime(entry.at)}
        </td>
        <td className="px-5 py-3 text-xs font-mono text-slate-600">{entry.actor}</td>
        <td className="px-5 py-3">
          <Badge variant="secondary">{auditActionLabel(entry.action)}</Badge>
        </td>
        <td className="px-5 py-3 text-xs">
          <span className="text-slate-500">{auditTargetTypeLabel(entry.target_type)}</span>
          {entry.target_id && (
            <span className="ml-1 text-slate-500 font-mono">#{entry.target_id.slice(0, 8)}</span>
          )}
        </td>
        <td className="px-5 py-3 text-right">
          {hasChanges && (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              aria-controls={changesId}
              aria-label={`${expanded ? 'Hide' : 'Show'} changes for audit entry ${entry.id}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </td>
      </tr>
      {expanded && hasChanges && (
        <tr id={changesId} className="border-b border-slate-100 bg-slate-50">
          <td colSpan={5} className="px-5 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {entry.before != null && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase mb-1">Before</p>
                  <pre className="rounded bg-white border border-slate-200 p-2 text-xs text-slate-600 overflow-x-auto max-h-40">
                    {JSON.stringify(entry.before, null, 2)}
                  </pre>
                </div>
              )}
              {entry.after != null && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase mb-1">After</p>
                  <pre className="rounded bg-white border border-slate-200 p-2 text-xs text-slate-600 overflow-x-auto max-h-40">
                    {JSON.stringify(entry.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function AuditPage() {
  const [page, setPage] = useState(1)
  const [actorInput, setActorInput] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState(ALL_ACTIONS)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  function handleActorChange(value: string) {
    setActorInput(value)
    setPage(1)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setActor(value)
    }, 300)
  }

  function handleActionChange(value: string) {
    setAction(value)
    setPage(1)
  }

  function handleFromChange(value: string) {
    setFrom(value)
    setPage(1)
  }

  function handleToChange(value: string) {
    setTo(value)
    setPage(1)
  }

  function clearFilters() {
    setActorInput('')
    setActor('')
    setAction(ALL_ACTIONS)
    setFrom('')
    setTo('')
    setPage(1)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const actionParam = action === ALL_ACTIONS ? undefined : action

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.audit.list({
      page,
      actor: actor || undefined,
      action: actionParam,
      from: from || undefined,
      to: to || undefined,
    }),
    queryFn: () =>
      getAuditLog({
        page,
        actor: actor || undefined,
        action: actionParam,
        from: from || undefined,
        to: to || undefined,
      }),
    placeholderData: (prev) => prev,
  })

  const entries = data?.entries ?? []
  const hasNext = data?.has_next ?? false

  const filtersActive = actorInput !== '' || action !== ALL_ACTIONS || from !== '' || to !== ''

  const actionValues = Array.from(
    new Set([...entries.map((e) => e.action), ...(actionParam ? [actionParam] : [])]),
  ).sort()

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Every change made here. Open a row to see what changed.
        </p>
      </div>

      <TableToolbar
        actions={
          <ExportButton<AuditEntry> rows={entries} columns={CSV_COLUMNS} filename="audit-log.csv" />
        }
      >
        <Input
          aria-label="Filter by who made the change"
          placeholder="Who (email, system, api:…)"
          value={actorInput}
          onChange={(e) => handleActorChange(e.target.value)}
          className="max-w-xs"
        />

        <Select value={action} onValueChange={handleActionChange} aria-label="Filter by action">
          <SelectItem value={ALL_ACTIONS}>All actions</SelectItem>
          {actionValues.map((value) => (
            <SelectItem key={value} value={value}>
              {auditActionLabel(value)}
            </SelectItem>
          ))}
        </Select>

        <Input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(e) => handleFromChange(e.target.value)}
          className="w-auto"
        />

        <Input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(e) => handleToChange(e.target.value)}
          className="w-auto"
        />

        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </TableToolbar>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5">
              <TableSkeleton rows={8} cols={5} />
            </div>
          ) : error ? (
            <div className="p-5">
              <QueryError
                title="Failed to load audit log"
                error={error}
                onRetry={() => void refetch()}
                isRetrying={isFetching}
              />
            </div>
          ) : entries.length === 0 ? (
            filtersActive ? (
              <EmptyState
                icon={SearchX}
                title="No matching entries"
                description="Try clearing a filter or widening the dates."
              />
            ) : (
              <EmptyState
                icon={Inbox}
                title="No audit entries yet"
                description="Changes will show up here as you make them."
              />
            )
          ) : (
            <table className="w-full text-sm" aria-label="Audit log entries">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                    When
                  </th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                    Who
                  </th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                    What happened
                  </th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                    Item
                  </th>
                  <th className="px-5 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-slate-500">Page {page}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft size={14} /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext}
          >
            Next <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}
