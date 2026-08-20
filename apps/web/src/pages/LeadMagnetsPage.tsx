import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Magnet,
  MinusCircle,
  Plus,
  Search,
  SearchX,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { ExportButton } from '../components/ui/data-export'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { ALL_PRODUCTS, ProductFilter } from '../components/ui/product-filter'
import { QueryError } from '../components/ui/query-error'
import { BulkActionBar, RowCheckbox, SelectAllCheckbox } from '../components/ui/row-select'
import { Select, SelectItem } from '../components/ui/select'
import { TableSkeleton } from '../components/ui/skeleton'
import { SortableHeader } from '../components/ui/sortable-header'
import { Spinner } from '../components/ui/spinner'
import { TableToolbar } from '../components/ui/toolbar'
import {
  createLeadMagnet,
  deleteLeadMagnet,
  getLeadMagnets,
  getProducts,
  updateLeadMagnet,
} from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { sequenceLabel } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { LeadMagnetRow } from '../lib/types'
import { useRowSelection } from '../lib/use-row-selection'
import type { SortableColumn } from '../lib/use-sortable-data'
import { useSortableData } from '../lib/use-sortable-data'

type LeadMagnetSortKey = 'name' | 'product' | 'slug' | 'active' | 'asset_size'

const SORT_COLUMNS: SortableColumn<LeadMagnetRow, LeadMagnetSortKey>[] = [
  { key: 'name', accessor: (row) => row.name },
  { key: 'product', accessor: (row) => row.product_name ?? row.product_slug ?? row.product_id },
  { key: 'slug', accessor: (row) => row.slug },
  { key: 'active', accessor: (row) => (row.active ? 1 : 0) },
  { key: 'asset_size', accessor: (row) => row.asset_size ?? null },
]

const CSV_COLUMNS: CsvColumn<LeadMagnetRow>[] = [
  { header: 'Name', accessor: (row) => row.name },
  { header: 'Product', accessor: (row) => row.product_name ?? row.product_slug ?? row.product_id },
  { header: 'Slug', accessor: (row) => row.slug },
  { header: 'Status', accessor: (row) => (row.active ? 'Active' : 'Inactive') },
  { header: 'Asset status', accessor: (row) => row.asset_status ?? null },
  { header: 'Asset size', accessor: (row) => row.asset_size ?? null },
  { header: 'Follow-up email', accessor: (row) => row.fulfillment_sequence_slug ?? null },
]

type AssetStatus = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getLeadMagnets>>[number]>['asset_status']
>

const assetStatusConfig: Record<
  AssetStatus,
  {
    label: string
    variant: 'success' | 'warning' | 'destructive' | 'outline'
    icon: typeof CheckCircle2
  }
> = {
  available: { label: 'File ready', variant: 'success', icon: CheckCircle2 },
  missing: { label: 'File missing', variant: 'destructive', icon: AlertTriangle },
  bucket_unbound: { label: 'Storage not linked', variant: 'warning', icon: AlertTriangle },
  not_configured: { label: 'No file yet', variant: 'outline', icon: MinusCircle },
  unknown: { label: 'File check failed', variant: 'warning', icon: AlertTriangle },
}

function AssetStatusBadge({ status }: { status?: AssetStatus }) {
  const config = assetStatusConfig[status ?? 'not_configured']
  const Icon = config.icon
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon size={11} /> {config.label}
    </Badge>
  )
}

function formatAssetSize(size?: number | null): string | null {
  if (typeof size !== 'number') return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// ---- Edit dialog ----

interface EditLeadMagnetDialogProps {
  lm: LeadMagnetRow
}

export function EditLeadMagnetDialog({ lm }: EditLeadMagnetDialogProps) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [assetKey, setAssetKey] = useState(lm.asset_r2_key ?? '')
  const [active, setActive] = useState(lm.active)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const editMutation = useMutation({
    mutationFn: (data: Partial<LeadMagnetRow>) => updateLeadMagnet(lm.id, data),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.leadMagnets() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Lead magnet updated')
      setOpen(false)
      setSubmitError(null)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update lead magnet')
    },
  })

  function handleSubmit() {
    editMutation.mutate({
      asset_r2_key: assetKey.trim() === '' ? null : assetKey.trim(),
      active,
    })
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setAssetKey(lm.asset_r2_key ?? '')
      setActive(lm.active)
      setSubmitError(null)
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Edit: ${lm.name}`}
        description="Change the file and turn it on or off."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`lm-asset-key-${lm.id}`} className="text-sm font-medium text-slate-700">
              File name
            </label>
            <Input
              id={`lm-asset-key-${lm.id}`}
              data-autofocus
              value={assetKey}
              onChange={(e) => setAssetKey(e.target.value)}
              placeholder="e.g. tenant-checklist.pdf"
            />
            <p className="text-xs text-slate-500">
              The name of the file in storage, like guide.pdf.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id={`lm-active-${lm.id}`}
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            />
            <label htmlFor={`lm-active-${lm.id}`} className="text-sm font-medium text-slate-700">
              Active
            </label>
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
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
              disabled={editMutation.isPending}
            >
              {editMutation.isPending ? (
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

// ---- New lead magnet dialog ----

interface NewLeadMagnetDialogProps {
  products: Array<{ id: string; slug: string; name: string }>
}

export function NewLeadMagnetDialog({ products }: NewLeadMagnetDialogProps) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [assetKey, setAssetKey] = useState('')
  const [active, setActive] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: createLeadMagnet,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.leadMagnets() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Lead magnet created')
      setOpen(false)
      resetForm()
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create lead magnet')
    },
  })

  function resetForm() {
    setProductId('')
    setSlug('')
    setName('')
    setAssetKey('')
    setActive(true)
    setSubmitError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    setOpen(next)
  }

  function handleSubmit() {
    if (!productId || !slug.trim() || !name.trim()) {
      setSubmitError('Product, slug, and name are required')
      return
    }
    createMutation.mutate({
      product_id: productId,
      slug: slug.trim(),
      name: name.trim(),
      asset_r2_key: assetKey.trim() === '' ? null : assetKey.trim(),
      active,
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus size={14} /> New lead magnet
        </Button>
      </DialogTrigger>
      <DialogContent title="New lead magnet" description="Create a new downloadable resource.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-lm-product" className="text-sm font-medium text-slate-700">
              Product
            </label>
            <Select
              id="new-lm-product"
              value={productId}
              onValueChange={setProductId}
              placeholder="Select product…"
              className="w-full"
            >
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-lm-slug" className="text-sm font-medium text-slate-700">
              Slug
            </label>
            <Input
              id="new-lm-slug"
              data-autofocus
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. tenant-checklist"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-lm-name" className="text-sm font-medium text-slate-700">
              Name
            </label>
            <Input
              id="new-lm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tenant Checklist"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-lm-asset-key" className="text-sm font-medium text-slate-700">
              File name
            </label>
            <Input
              id="new-lm-asset-key"
              value={assetKey}
              onChange={(e) => setAssetKey(e.target.value)}
              placeholder="e.g. tenant-checklist.pdf"
            />
            <p className="text-xs text-slate-500">
              The name of the file in storage, like guide.pdf.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="new-lm-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            />
            <label htmlFor="new-lm-active" className="text-sm font-medium text-slate-700">
              Active
            </label>
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
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
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>
                  <Spinner /> Creating
                </>
              ) : (
                'Create'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- Toggle active inline action ----

interface ToggleActiveButtonProps {
  lm: LeadMagnetRow
}

function ToggleActiveButton({ lm }: ToggleActiveButtonProps) {
  const qc = useQueryClient()

  const toggleMutation = useMutation({
    mutationFn: () => updateLeadMagnet(lm.id, { active: !lm.active }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.leadMagnets() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success(lm.active ? 'Lead magnet deactivated' : 'Lead magnet activated')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle active state')
    },
  })

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-xs"
      onClick={() => toggleMutation.mutate()}
      disabled={toggleMutation.isPending}
    >
      {lm.active ? 'Deactivate' : 'Activate'}
    </Button>
  )
}

// ---- Delete dialog ----

interface DeleteLeadMagnetDialogProps {
  lm: LeadMagnetRow
}

function DeleteLeadMagnetDialog({ lm }: DeleteLeadMagnetDialogProps) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: () => deleteLeadMagnet(lm.id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.leadMagnets() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Lead magnet deleted')
      setSubmitError(null)
      setOpen(false)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to delete lead magnet')
    },
  })

  function handleOpenChange(next: boolean) {
    if (next) setSubmitError(null)
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="destructive-outline"
          size="sm"
          className="text-xs"
          aria-label={`Delete ${lm.slug}`}
        >
          <Trash2 size={13} /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Delete lead magnet?"
        description={`Remove ${lm.name} from the lead magnet list. Existing captured contacts keep their history.`}
      >
        <div className="space-y-4">
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Spinner /> Deleting
                </>
              ) : (
                'Delete lead magnet'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- Page ----

export function LeadMagnetsPage() {
  const qc = useQueryClient()
  const {
    data: leadMagnets,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.leadMagnets(),
    queryFn: getLeadMagnets,
  })
  const { data: products } = useQuery({
    queryKey: queryKeys.products(),
    queryFn: getProducts,
  })

  const [search, setSearch] = useState('')
  const [product, setProduct] = useState<string>(ALL_PRODUCTS)

  const rows = useMemo(() => leadMagnets ?? [], [leadMagnets])
  const productMap = useMemo(
    () => Object.fromEntries((products ?? []).map((p) => [p.id, p])),
    [products],
  )

  // Build the product filter options from the loaded rows, deduped + sorted by
  // name. Slugs referenced by rows but missing from the products list are kept
  // as orphan fallbacks so they can still be filtered on.
  const filterProducts = useMemo(() => {
    const map = new Map<string, { id: string; slug: string; name: string }>()
    for (const lm of rows) {
      const slug = lm.product_slug ?? lm.product_id
      if (!map.has(slug)) {
        map.set(slug, {
          id: lm.product_id,
          slug,
          name: lm.product_name ?? productMap[lm.product_id]?.name ?? slug,
        })
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, productMap])

  const query = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      rows.filter((lm) => {
        const slug = lm.product_slug ?? lm.product_id
        if (product !== ALL_PRODUCTS && slug !== product) return false
        if (query === '') return true
        const haystack = [
          lm.name,
          lm.slug,
          lm.product_name ?? '',
          lm.product_slug ?? '',
          productMap[lm.product_id]?.name ?? '',
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      }),
    [rows, product, query, productMap],
  )

  const { sorted, sort, toggleSort } = useSortableData<LeadMagnetRow, LeadMagnetSortKey>(
    filtered,
    SORT_COLUMNS,
  )

  const rowIds = useMemo(() => sorted.map((r) => r.id), [sorted])
  const sel = useRowSelection<string>(rowIds)

  const bulkSetActive = useMutation({
    mutationFn: ({ ids, active }: { ids: string[]; active: boolean }) =>
      Promise.all(ids.map((id) => updateLeadMagnet(id, { active }))),
    onSuccess: async (_data, variables) => {
      toast.success(`Updated ${variables.ids.length} lead magnets`)
      sel.clear()
      await qc.invalidateQueries({ queryKey: queryKeys.leadMagnets() })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update lead magnets')
    },
  })

  function handleBulkSetActive(active: boolean) {
    const ids = rowIds.filter((id) => sel.isSelected(id))
    if (ids.length === 0) return
    bulkSetActive.mutate({ ids, active })
  }

  const hasData = rows.length > 0

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Lead Magnets</h1>
          <p className="text-sm text-slate-500 mt-0.5">Free downloads you give to collect emails</p>
        </div>
        <NewLeadMagnetDialog products={products ?? []} />
      </div>

      {hasData && !isLoading && !error && (
        <TableToolbar
          actions={
            <ExportButton<LeadMagnetRow>
              rows={sorted}
              columns={CSV_COLUMNS}
              filename="lead-magnets.csv"
            />
          }
        >
          <div className="relative max-w-sm">
            <label htmlFor="lead-magnets-search" className="sr-only">
              Search lead magnets
            </label>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              id="lead-magnets-search"
              aria-label="Search lead magnets"
              placeholder="Search lead magnets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <ProductFilter
            value={product}
            onChange={setProduct}
            products={filterProducts}
            aria-label="Filter lead magnets by product"
          />
        </TableToolbar>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5">
              <TableSkeleton rows={5} cols={7} />
            </div>
          ) : error ? (
            <div className="p-5">
              <QueryError
                title="Failed to load lead magnets"
                error={error}
                onRetry={() => void refetch()}
                isRetrying={isFetching}
              />
            </div>
          ) : !hasData ? (
            <EmptyState
              icon={Magnet}
              title="No lead magnets yet"
              description="A lead magnet is a free file. You give it away for an email. Add your first one to start sign-ups."
            />
          ) : sorted.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <SearchX size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-600">No lead magnets found</p>
              <p className="text-xs text-slate-500 mt-1">
                Try a different search or product filter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Lead magnets">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2.5 text-left">
                      <SelectAllCheckbox
                        checked={sel.allSelected}
                        indeterminate={sel.someSelected}
                        onChange={() => sel.toggleAll()}
                        aria-label="Select all lead magnets"
                      />
                    </th>
                    <SortableHeader
                      field="name"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Name
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
                      field="slug"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Slug
                    </SortableHeader>
                    <SortableHeader
                      field="active"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Status
                    </SortableHeader>
                    <SortableHeader
                      field="asset_size"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Asset
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Follow-up Email
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((lm) => {
                    const product = productMap[lm.product_id]
                    const assetSize = formatAssetSize(lm.asset_size)
                    const assetBucket = lm.effective_asset_r2_bucket ?? lm.asset_r2_bucket
                    return (
                      <tr
                        key={lm.id}
                        className="border-b border-slate-50 hover:bg-slate-50 transition-colors align-top"
                      >
                        <td className="px-5 py-3">
                          <RowCheckbox
                            checked={sel.isSelected(lm.id)}
                            onChange={() => sel.toggle(lm.id)}
                            aria-label={`Select ${lm.name}`}
                          />
                        </td>
                        <td className="px-5 py-3 font-medium text-slate-900">{lm.name}</td>
                        <td className="px-5 py-3">
                          <Badge variant="secondary">
                            {lm.product_name ?? product?.name ?? lm.product_id}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">{lm.slug}</td>
                        <td className="px-5 py-3">
                          <Badge variant={lm.active ? 'success' : 'outline'}>
                            {lm.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          <div className="space-y-1.5">
                            <AssetStatusBadge status={lm.asset_status} />
                            <div className="space-y-0.5 font-mono text-[11px] text-slate-500">
                              <div>
                                {assetBucket ?? (
                                  <span className="text-slate-500">No storage set</span>
                                )}
                              </div>
                              <div className="break-all">
                                {lm.asset_r2_key ?? (
                                  <span className="text-slate-500">No file set</span>
                                )}
                              </div>
                            </div>
                            {assetSize && (
                              <div className="text-[11px] text-slate-500">{assetSize}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600">
                          {lm.fulfillment_sequence_slug ? (
                            sequenceLabel(lm.fulfillment_sequence_slug, product?.slug)
                          ) : (
                            <span className="text-slate-500">No follow-up email</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1">
                            <EditLeadMagnetDialog lm={lm} />
                            <ToggleActiveButton lm={lm} />
                            <DeleteLeadMagnetDialog lm={lm} />
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

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <Button
          variant="outline"
          size="sm"
          disabled={bulkSetActive.isPending}
          onClick={() => handleBulkSetActive(true)}
        >
          {bulkSetActive.isPending ? (
            <>
              <Spinner /> Updating
            </>
          ) : (
            'Activate selected'
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={bulkSetActive.isPending}
          onClick={() => handleBulkSetActive(false)}
        >
          {bulkSetActive.isPending ? (
            <>
              <Spinner /> Updating
            </>
          ) : (
            'Deactivate selected'
          )}
        </Button>
      </BulkActionBar>
    </div>
  )
}
