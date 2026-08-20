import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, SearchX, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { ExportButton } from '../components/ui/data-export'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { QueryError } from '../components/ui/query-error'
import { Select, SelectItem } from '../components/ui/select'
import { TableSkeleton } from '../components/ui/skeleton'
import { SortableHeader } from '../components/ui/sortable-header'
import { Spinner } from '../components/ui/spinner'
import { TableToolbar } from '../components/ui/toolbar'
import {
  createSequence,
  deleteSequence,
  getProducts,
  getSequences,
  updateSequence,
} from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { formatDate } from '../lib/dates'
import { sequenceLabel } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { ProductRow, SequenceRow } from '../lib/types'
import type { SortableColumn } from '../lib/use-sortable-data'
import { useSortableData } from '../lib/use-sortable-data'
import { formatDelay, formatSkipIf, formatSubject } from './sequence-step-format'

type SequenceSortKey = 'slug' | 'product' | 'version' | 'steps' | 'status'

function stepCountOf(seq: SequenceRow): number {
  const def = seq.definition as { steps?: unknown[] } | null
  return def?.steps?.length ?? 0
}

export function StepTable({ definition }: { definition: unknown }) {
  const def = definition as {
    steps?: Array<{
      delay?: string
      template?: string
      subject?: unknown
      skip_if?: Record<string, unknown>
    }>
  } | null
  const steps = def?.steps ?? []
  if (steps.length === 0) return <p className="text-sm text-slate-500">No steps defined.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" aria-label="Sequence steps">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="py-1.5 pr-3 text-left text-slate-500 font-medium">#</th>
            <th className="py-1.5 pr-3 text-left text-slate-500 font-medium">Email subject</th>
            <th className="py-1.5 pr-3 text-left text-slate-500 font-medium">Wait</th>
            <th className="py-1.5 text-left text-slate-500 font-medium">Skip if</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, i) => (
            <tr key={i} className="border-b border-slate-50">
              <td className="py-1.5 pr-3 align-top text-slate-700">{i + 1}</td>
              <td className="py-1.5 pr-3 align-top text-slate-700">
                {formatSubject(step.subject)}
              </td>
              <td className="py-1.5 pr-3 align-top whitespace-nowrap text-slate-600">
                {formatDelay(step.delay)}
              </td>
              <td className="py-1.5 align-top text-slate-500">{formatSkipIf(step.skip_if)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Turn a snake_case goal token (e.g. "drive_engagement") into a readable label. */
export function humanizeGoal(goal: string): string {
  const spaced = goal.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function SequenceDetailDialog({
  seq,
  productName,
  label,
}: {
  seq: SequenceRow
  productName: string
  label: string
}) {
  const def = seq.definition as { steps?: unknown[] } | null
  const stepCount = def?.steps?.length ?? 0

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="group text-left w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          aria-haspopup="dialog"
          aria-label={`View ${seq.slug}`}
        >
          <span className="block text-sm font-medium text-blue-700 group-hover:underline cursor-pointer">
            {label}
          </span>
          <span className="block font-mono text-[11px] text-slate-500">{seq.slug}</span>
        </button>
      </DialogTrigger>
      <DialogContent
        title={label}
        description={`${productName} · ${seq.slug} · version ${seq.version} · ${stepCount} step${stepCount === 1 ? '' : 's'}`}
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {seq.goal && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase mb-1">Goal</p>
              <p className="text-sm text-slate-700">{humanizeGoal(seq.goal)}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase mb-2">Steps</p>
            <StepTable definition={seq.definition} />
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 uppercase select-none hover:text-slate-700">
              Raw definition (advanced)
            </summary>
            <pre className="mt-2 rounded bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 overflow-x-auto max-h-40">
              {JSON.stringify(seq.definition, null, 2)}
            </pre>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SequenceEditDialog({ seq, label }: { seq: SequenceRow; label: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [goal, setGoal] = useState(seq.goal ?? '')
  const [active, setActive] = useState(seq.is_active)
  const [definitionJson, setDefinitionJson] = useState(() =>
    JSON.stringify(seq.definition ?? {}, null, 2),
  )
  const [submitError, setSubmitError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (data: { goal: string | null; is_active: boolean; definition: unknown }) =>
      updateSequence(seq.slug, data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sequences() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Sequence updated')
      setSubmitError(null)
      setOpen(false)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update sequence')
    },
  })

  function resetForm() {
    setGoal(seq.goal ?? '')
    setActive(seq.is_active)
    setDefinitionJson(JSON.stringify(seq.definition ?? {}, null, 2))
    setSubmitError(null)
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm()
    setOpen(next)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let definition: unknown
    try {
      definition = JSON.parse(definitionJson)
    } catch {
      setSubmitError('Definition JSON is not valid.')
      return
    }
    if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
      setSubmitError('Definition JSON must be an object.')
      return
    }

    mutation.mutate({
      goal: goal.trim() === '' ? null : goal.trim(),
      is_active: active,
      definition,
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Edit ${seq.slug}`} className="text-xs">
          <Pencil size={13} /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Edit: ${label}`}
        description={`${seq.slug} · version ${seq.version}`}
        className="max-w-2xl"
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label
              htmlFor={`sequence-goal-${seq.slug}`}
              className="text-sm font-medium text-slate-700"
            >
              Goal
            </label>
            <Input
              id={`sequence-goal-${seq.slug}`}
              data-autofocus
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. onboarding"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id={`sequence-active-${seq.slug}`}
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            <label
              htmlFor={`sequence-active-${seq.slug}`}
              className="text-sm font-medium text-slate-700"
            >
              Active
            </label>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`sequence-definition-${seq.slug}`}
              className="text-sm font-medium text-slate-700"
            >
              Definition JSON
            </label>
            <textarea
              id={`sequence-definition-${seq.slug}`}
              value={definitionJson}
              onChange={(event) => setDefinitionJson(event.target.value)}
              className="min-h-64 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              spellCheck={false}
            />
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Spinner /> Saving
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SequenceCreateDialog({ products }: { products: ProductRow[] }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [goal, setGoal] = useState('')
  const [active, setActive] = useState(true)
  const [definitionJson, setDefinitionJson] = useState('{\n  "steps": []\n}')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (data: {
      slug: string
      product_id: string
      goal: string | null
      is_active: boolean
      definition: unknown
    }) => createSequence(data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sequences() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Sequence created')
      setSubmitError(null)
      setOpen(false)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create sequence')
    },
  })

  function resetForm() {
    setSlug('')
    setProductId(products[0]?.id ?? '')
    setGoal('')
    setActive(true)
    setDefinitionJson('{\n  "steps": []\n}')
    setSubmitError(null)
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm()
    setOpen(next)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextSlug = slug.trim()
    if (!nextSlug) {
      setSubmitError('Slug is required.')
      return
    }
    if (!productId) {
      setSubmitError('Product is required.')
      return
    }

    let definition: unknown
    try {
      definition = JSON.parse(definitionJson)
    } catch {
      setSubmitError('Definition JSON is not valid.')
      return
    }
    if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
      setSubmitError('Definition JSON must be an object.')
      return
    }

    mutation.mutate({
      slug: nextSlug,
      product_id: productId,
      goal: goal.trim() === '' ? null : goal.trim(),
      is_active: active,
      definition,
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" aria-label="New sequence">
          <Plus size={13} /> New sequence
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New sequence"
        description="Creates a synced sequence row in D1. YAML sync may overwrite dashboard edits."
        className="max-w-2xl"
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="sequence-create-slug" className="text-sm font-medium text-slate-700">
                Slug
              </label>
              <Input
                id="sequence-create-slug"
                data-autofocus
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="welcome-flow"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="sequence-create-product"
                className="text-sm font-medium text-slate-700"
              >
                Product
              </label>
              <Select
                id="sequence-create-product"
                aria-label="Product"
                value={productId}
                onValueChange={setProductId}
                placeholder="Select product"
                className="w-full rounded-full"
              >
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="sequence-create-goal" className="text-sm font-medium text-slate-700">
              Goal
            </label>
            <Input
              id="sequence-create-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. onboarding"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="sequence-create-active"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            <label htmlFor="sequence-create-active" className="text-sm font-medium text-slate-700">
              Active
            </label>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="sequence-create-definition"
              className="text-sm font-medium text-slate-700"
            >
              Definition JSON
            </label>
            <textarea
              id="sequence-create-definition"
              value={definitionJson}
              onChange={(event) => setDefinitionJson(event.target.value)}
              className="min-h-64 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              spellCheck={false}
            />
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={mutation.isPending || products.length === 0}>
              {mutation.isPending ? (
                <>
                  <Spinner /> Creating
                </>
              ) : (
                'Create sequence'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SequenceDeleteDialog({ seq, label }: { seq: SequenceRow; label: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => deleteSequence(seq.slug),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sequences() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Sequence deleted')
      setSubmitError(null)
      setOpen(false)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to delete sequence')
    },
  })

  function handleOpenChange(next: boolean) {
    setSubmitError(null)
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="destructive-outline"
          size="sm"
          aria-label={`Delete ${seq.slug}`}
          className="text-xs"
        >
          <Trash2 size={13} /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Delete: ${label}`}
        description="Sequences with run history cannot be deleted."
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Delete <span className="font-mono text-slate-900">{seq.slug}</span> from synced D1
            definitions.
          </p>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? (
                <>
                  <Spinner /> Deleting
                </>
              ) : (
                'Delete sequence'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SequencesPage() {
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [productFilter, setProductFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const {
    data: sequences,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.sequences(),
    queryFn: () => getSequences(),
  })
  const { data: products } = useQuery({
    queryKey: queryKeys.products(),
    queryFn: getProducts,
  })

  const productMap = Object.fromEntries((products ?? []).map((p) => [p.id, p]))
  const productFilterOptions = [...(products ?? []).map((p) => ({ id: p.id, label: p.name }))]
  for (const seq of sequences ?? []) {
    if (!productMap[seq.product_id] && !productFilterOptions.some((p) => p.id === seq.product_id)) {
      productFilterOptions.push({ id: seq.product_id, label: seq.product_id })
    }
  }

  function productNameOf(seq: SequenceRow): string {
    return productMap[seq.product_id]?.name ?? seq.product_id
  }

  const SORT_COLUMNS: SortableColumn<SequenceRow, SequenceSortKey>[] = [
    { key: 'slug', accessor: (s) => sequenceLabel(s.slug, productMap[s.product_id]?.slug) },
    { key: 'product', accessor: (s) => productNameOf(s) },
    { key: 'version', accessor: (s) => s.version },
    { key: 'steps', accessor: (s) => stepCountOf(s) },
    { key: 'status', accessor: (s) => (s.is_active ? 'Active' : 'Inactive') },
  ]

  const CSV_COLUMNS: CsvColumn<SequenceRow>[] = [
    { header: 'Sequence', accessor: (s) => sequenceLabel(s.slug, productMap[s.product_id]?.slug) },
    { header: 'Slug', accessor: (s) => s.slug },
    { header: 'Product', accessor: (s) => productNameOf(s) },
    { header: 'Version', accessor: (s) => s.version },
    { header: 'Steps', accessor: (s) => stepCountOf(s) },
    { header: 'Status', accessor: (s) => (s.is_active ? 'Active' : 'Inactive') },
    { header: 'Compiled', accessor: (s) => s.compiled_at || null },
  ]

  const filtered = (sequences ?? []).filter((s) => {
    const term = search.toLowerCase()
    const haystack = [
      s.slug,
      sequenceLabel(s.slug, productMap[s.product_id]?.slug),
      productNameOf(s),
    ]
      .join(' ')
      .toLowerCase()
    const matchSearch = search === '' || haystack.includes(term)
    const matchProduct = productFilter === 'all' || s.product_id === productFilter
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && s.is_active) ||
      (statusFilter === 'inactive' && !s.is_active)
    return matchSearch && matchProduct && matchStatus
  })

  const { sorted, sort, toggleSort } = useSortableData<SequenceRow, SequenceSortKey>(
    filtered,
    SORT_COLUMNS,
  )

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sequences</h1>
        <p className="text-sm text-slate-500 mt-0.5">All compiled email sequences</p>
      </div>

      <TableToolbar
        actions={
          <>
            <SequenceCreateDialog products={products ?? []} />
            <ExportButton<SequenceRow>
              rows={sorted}
              columns={CSV_COLUMNS}
              filename="sequences.csv"
            />
          </>
        }
      >
        <div className="relative min-w-40 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Search sequences"
            placeholder="Search sequences..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          aria-label="Filter sequences by product"
          value={productFilter}
          onValueChange={setProductFilter}
          placeholder="All products"
          className="w-44"
        >
          <SelectItem value="all">All products</SelectItem>
          {productFilterOptions.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label="Filter sequences by status"
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Status"
          className="w-36"
        >
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </Select>
      </TableToolbar>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5">
              <TableSkeleton rows={6} cols={6} />
            </div>
          ) : error ? (
            <div className="p-5">
              <QueryError
                title="Failed to load sequences"
                error={error}
                onRetry={() => void refetch()}
                isRetrying={isFetching}
              />
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No sequences found"
              description={
                search !== '' || productFilter !== 'all' || statusFilter !== 'all'
                  ? 'Try a different search or product filter.'
                  : 'Compiled sequences will show up here.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Email sequences">
                <thead>
                  <tr className="border-b border-slate-100">
                    <SortableHeader
                      field="slug"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Sequence
                    </SortableHeader>
                    <SortableHeader
                      field="product"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Product
                    </SortableHeader>
                    <SortableHeader
                      field="version"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase"
                    >
                      Version
                    </SortableHeader>
                    <SortableHeader
                      field="steps"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase"
                    >
                      Steps
                    </SortableHeader>
                    <SortableHeader
                      field="status"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Status
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Compiled
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((seq) => {
                    const stepCount = stepCountOf(seq)
                    const product = productMap[seq.product_id]
                    return (
                      <tr
                        key={seq.slug}
                        className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3">
                          <SequenceDetailDialog
                            seq={seq}
                            productName={product?.name ?? seq.product_id}
                            label={sequenceLabel(seq.slug, product?.slug)}
                          />
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant="secondary">{product?.name ?? seq.product_id}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500">v{seq.version}</td>
                        <td className="px-5 py-3 text-right text-slate-500">{stepCount}</td>
                        <td className="px-5 py-3">
                          <Badge variant={seq.is_active ? 'success' : 'outline'}>
                            {seq.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {formatDate(seq.compiled_at)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <SequenceEditDialog
                              seq={seq}
                              label={sequenceLabel(seq.slug, product?.slug)}
                            />
                            <SequenceDeleteDialog
                              seq={seq}
                              label={sequenceLabel(seq.slug, product?.slug)}
                            />
                          </div>
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
    </div>
  )
}
