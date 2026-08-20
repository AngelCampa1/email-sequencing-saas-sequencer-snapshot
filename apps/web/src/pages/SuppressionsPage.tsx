import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
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
import { Card, CardContent } from '../components/ui/card'
import { ExportButton } from '../components/ui/data-export'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { QueryError } from '../components/ui/query-error'
import { BulkActionBar, RowCheckbox, SelectAllCheckbox } from '../components/ui/row-select'
import { Select, SelectItem } from '../components/ui/select'
import { TableSkeleton } from '../components/ui/skeleton'
import { SortableHeader } from '../components/ui/sortable-header'
import { Spinner } from '../components/ui/spinner'
import { TablePagination } from '../components/ui/table-pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { TableToolbar } from '../components/ui/toolbar'
import {
  addSuppression,
  getProducts,
  getSuppressions,
  removeSuppression,
  type SuppressionsQuery,
} from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { EM_DASH, formatDate } from '../lib/dates'
import { suppressionSourceLabel } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { ProductRow, SuppressionRow } from '../lib/types'
import { useRowSelection } from '../lib/use-row-selection'
import type { SortableColumn, SortState } from '../lib/use-sortable-data'
import { sortRows } from '../lib/use-sortable-data'

const PAGE_SIZE = 100

type SuppressionScope = 'global' | 'product'
type SuppressionSortKey = 'email' | 'created_at'

const SORT_COLUMNS: SortableColumn<SuppressionRow, SuppressionSortKey>[] = [
  { key: 'email', accessor: (row) => row.email },
  { key: 'created_at', accessor: (row) => row.created_at },
]

const sourceVariant: Record<
  SuppressionRow['source'],
  'secondary' | 'destructive' | 'warning' | 'outline'
> = {
  manual: 'secondary',
  webhook: 'outline',
  list_import: 'outline',
  complaint: 'destructive',
  bounce: 'warning',
  suppression: 'secondary',
  instantly_webhook: 'outline',
}

type AddSuppressionFormState = {
  email: string
  scope: 'global' | 'product'
  productId: string
  reason: string
  submitError: string | null
}

type AddSuppressionFormAction =
  | { type: 'setEmail'; value: string }
  | { type: 'setScope'; value: 'global' | 'product' }
  | { type: 'setProductId'; value: string }
  | { type: 'setReason'; value: string }
  | { type: 'dialogOpened' }
  | { type: 'dialogClosed' }
  | { type: 'submitSucceeded' }
  | { type: 'submitFailed'; value: string }

export const initialAddSuppressionFormState: AddSuppressionFormState = {
  email: '',
  scope: 'global',
  productId: '',
  reason: '',
  submitError: null,
}

export function canSubmitAddSuppression(input: {
  isSaving: boolean
  scope: 'global' | 'product'
  productId: string
}): boolean {
  return !input.isSaving && (input.scope === 'global' || input.productId !== '')
}

type SuppressionProductOption = Pick<ProductRow, 'id' | 'name'>

export function buildSuppressionProductOptions(
  products: ProductRow[] | undefined,
  productSuppressions: SuppressionRow[],
): SuppressionProductOption[] {
  const options = new Map<string, SuppressionProductOption>()

  for (const product of products ?? []) {
    options.set(product.id, { id: product.id, name: product.name })
  }

  for (const suppression of productSuppressions) {
    if (suppression.product_id && !options.has(suppression.product_id)) {
      options.set(suppression.product_id, {
        id: suppression.product_id,
        name: suppression.product_id,
      })
    }
  }

  return [...options.values()]
}

export function addSuppressionFormReducer(
  state: AddSuppressionFormState,
  action: AddSuppressionFormAction,
): AddSuppressionFormState {
  switch (action.type) {
    case 'setEmail':
      return { ...state, email: action.value }
    case 'setScope':
      return { ...state, scope: action.value }
    case 'setProductId':
      return { ...state, productId: action.value }
    case 'setReason':
      return { ...state, reason: action.value }
    case 'dialogOpened':
      return { ...state, submitError: null }
    case 'dialogClosed':
    case 'submitSucceeded':
      return initialAddSuppressionFormState
    case 'submitFailed':
      return { ...state, submitError: action.value }
  }
}

// ---------------------------------------------------------------------------
// Search debounce helpers (mirrors ContactsPage)
// ---------------------------------------------------------------------------

export type SuppressionsSearchTimerRef = {
  current: ReturnType<typeof setTimeout> | null
}

export function clearSuppressionsSearchTimer(timerRef: SuppressionsSearchTimerRef) {
  if (timerRef.current) {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

export function scheduleSuppressionsSearchUpdate(
  timerRef: SuppressionsSearchTimerRef,
  value: string,
  updateSearch: (value: string) => void,
) {
  clearSuppressionsSearchTimer(timerRef)
  timerRef.current = setTimeout(() => {
    timerRef.current = null
    updateSearch(value)
  }, 300)
}

function AddSuppressionDialog({ products }: { products: SuppressionProductOption[] }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, dispatchForm] = useReducer(addSuppressionFormReducer, initialAddSuppressionFormState)

  const addMutation = useMutation({
    mutationFn: addSuppression,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.suppressions() }),
        qc.invalidateQueries({ queryKey: queryKeys.contacts() }),
        qc.invalidateQueries({ queryKey: queryKeys.overview() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
        qc.invalidateQueries({ queryKey: queryKeys.contactDetailAll() }),
      ])
      toast.success('Address blocked')
      setOpen(false)
      dispatchForm({ type: 'submitSucceeded' })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'We could not block this address.'
      toast.error(message)
      dispatchForm({ type: 'submitFailed', value: message })
    },
  })

  const canSubmit = canSubmitAddSuppression({
    isSaving: addMutation.isPending,
    scope: form.scope,
    productId: form.productId,
  })
  const productRequiredErrorId = 'suppression-product-required'
  const hasProductRequiredError = form.scope === 'product' && form.productId === ''

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    dispatchForm({ type: 'dialogOpened' })
    if (!canSubmit) return
    addMutation.mutate({
      email: form.email,
      scope: form.scope,
      product_id: form.scope === 'product' ? form.productId : undefined,
      reason: form.reason || undefined,
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
        <Button size="sm">
          <Plus size={14} /> Block an address
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Block an address"
        description="We block all emails to this address right away."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="suppression-email" className="text-xs font-medium text-slate-700">
              Email *
            </label>
            <Input
              id="suppression-email"
              data-autofocus
              value={form.email}
              onChange={(e) => dispatchForm({ type: 'setEmail', value: e.target.value })}
              placeholder="user@example.com"
              required
              aria-required="true"
              type="email"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="suppression-scope" className="text-xs font-medium text-slate-700">
              Where it applies *
            </label>
            <Select
              id="suppression-scope"
              value={form.scope}
              onValueChange={(v) =>
                dispatchForm({ type: 'setScope', value: v as 'global' | 'product' })
              }
              className="w-full"
            >
              <SelectItem value="global">All products</SelectItem>
              <SelectItem value="product">One product</SelectItem>
            </Select>
          </div>
          {form.scope === 'product' && (
            <div className="space-y-1">
              <label htmlFor="suppression-product" className="text-xs font-medium text-slate-700">
                Product *
              </label>
              <Select
                id="suppression-product"
                value={form.productId}
                onValueChange={(value) => dispatchForm({ type: 'setProductId', value })}
                placeholder="Select product"
                className="w-full"
                aria-invalid={hasProductRequiredError}
                aria-describedby={hasProductRequiredError ? productRequiredErrorId : undefined}
              >
                {(products ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </Select>
              {hasProductRequiredError && (
                <p id={productRequiredErrorId} className="text-xs text-red-600">
                  Choose which product this block is for.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="suppression-reason" className="text-xs font-medium text-slate-700">
              Reason
            </label>
            <Input
              id="suppression-reason"
              value={form.reason}
              onChange={(e) => dispatchForm({ type: 'setReason', value: e.target.value })}
              placeholder="Optional note..."
            />
          </div>
          {form.submitError && (
            <p role="alert" className="text-sm text-red-600">
              We could not block this address: {form.submitError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {addMutation.isPending ? (
                <>
                  <Spinner /> Saving
                </>
              ) : (
                'Block address'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveSuppressionButton({ suppression }: { suppression: SuppressionRow }) {
  const qc = useQueryClient()
  const removeMutation = useMutation({
    mutationFn: () => removeSuppression(suppression.id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.suppressions() }),
        qc.invalidateQueries({ queryKey: queryKeys.contacts() }),
        qc.invalidateQueries({ queryKey: queryKeys.overview() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
        qc.invalidateQueries({ queryKey: queryKeys.contactDetailAll() }),
      ])
      toast.success('Address unblocked')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'We could not unblock this address.'
      toast.error(message)
    },
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive-outline" size="sm" className="h-6 px-2 text-xs">
          Unblock
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        title="Unblock this address?"
        description={`This unblocks ${suppression.email}. We may email this address again.`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <AlertDialogCancel asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              size="sm"
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              {removeMutation.isPending ? (
                <>
                  <Spinner /> Unblocking
                </>
              ) : (
                'Unblock'
              )}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type ScopeControls = {
  searchInput: string
  onSearch: (value: string) => void
  sort: SortState<SuppressionSortKey>
  onToggleSort: (key: SuppressionSortKey) => void
  page: number
  onPrev: () => void
  onNext: () => void
}

function SuppressionTabPanel({
  scope,
  rows,
  products,
  isLoading,
  error,
  onRetry,
  isFetching,
  controls,
}: {
  scope: SuppressionScope
  rows: SuppressionRow[]
  products: ProductRow[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  isFetching: boolean
  controls: ScopeControls
}) {
  const qc = useQueryClient()
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
  // Build CSV columns inside the component so the Product column exports the
  // product NAME (matching the on-screen table), falling back to the id.
  const csvColumns = useMemo<CsvColumn<SuppressionRow>[]>(
    () => [
      { header: 'Email', accessor: (row) => row.email },
      {
        header: 'Product',
        accessor: (row) =>
          row.product_id ? (productMap[row.product_id]?.name ?? row.product_id) : null,
      },
      { header: 'Reason', accessor: (row) => row.reason ?? null },
      { header: 'Source', accessor: (row) => row.source },
      { header: 'Date', accessor: (row) => row.created_at },
    ],
    [productMap],
  )
  const label =
    scope === 'global' ? 'Blocked addresses for all products' : 'Blocked addresses for one product'
  const searchAriaLabel =
    scope === 'global'
      ? 'Search blocked addresses for all products'
      : 'Search blocked addresses for one product'
  const filename = scope === 'global' ? 'suppressions-global.csv' : 'suppressions-product.csv'
  const searchInputId = `suppressions-search-${scope}`

  const sortedRows = sortRows<SuppressionRow, SuppressionSortKey>(rows, SORT_COLUMNS, controls.sort)
  const sel = useRowSelection<string>(sortedRows.map((r) => r.id))

  const bulkUnblock = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => removeSuppression(id))),
    onSuccess: async (_data, ids) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.suppressions() }),
        qc.invalidateQueries({ queryKey: queryKeys.contacts() }),
        qc.invalidateQueries({ queryKey: queryKeys.overview() }),
        qc.invalidateQueries({ queryKey: queryKeys.audit.all() }),
        qc.invalidateQueries({ queryKey: queryKeys.contactDetailAll() }),
      ])
      toast.success(`Unblocked ${ids.length} addresses`)
      sel.clear()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'We could not unblock these addresses.'
      toast.error(message)
    },
  })

  function handleBulkUnblock() {
    const ids = sortedRows.map((r) => r.id).filter((id) => sel.isSelected(id))
    if (ids.length === 0) return
    bulkUnblock.mutate(ids)
  }

  const hasMore = rows.length === PAGE_SIZE

  return (
    <>
      <TableToolbar
        actions={
          <ExportButton<SuppressionRow>
            rows={sortedRows}
            columns={csvColumns}
            filename={filename}
          />
        }
      >
        <div className="relative max-w-sm">
          <label htmlFor={searchInputId} className="sr-only">
            Search blocked addresses
          </label>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id={searchInputId}
            aria-label={searchAriaLabel}
            placeholder="Search blocked addresses..."
            value={controls.searchInput}
            onChange={(e) => controls.onSearch(e.target.value)}
            className="pl-8"
          />
        </div>
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
                title={
                  scope === 'global'
                    ? 'We could not load the all-products list.'
                    : 'We could not load the one-product list.'
                }
                error={error}
                onRetry={onRetry}
                isRetrying={isFetching}
              />
            </div>
          ) : sortedRows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No blocked addresses yet"
              description="Blocked email addresses show up here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label={label}>
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2.5 text-left">
                      <SelectAllCheckbox
                        checked={sel.allSelected}
                        indeterminate={sel.someSelected}
                        onChange={() => sel.toggleAll()}
                        aria-label="Select all blocked addresses"
                      />
                    </th>
                    <SortableHeader
                      field="email"
                      sort={controls.sort}
                      onToggle={controls.onToggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Email
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Product
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Reason
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Source
                    </th>
                    <SortableHeader
                      field="created_at"
                      sort={controls.sort}
                      onToggle={controls.onToggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Date
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <RowCheckbox
                          checked={sel.isSelected(s.id)}
                          onChange={() => sel.toggle(s.id)}
                          aria-label={`Select ${s.email}`}
                        />
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-700 break-all">
                        {s.email}
                      </td>
                      <td className="px-5 py-3">
                        {s.product_id ? (
                          <Badge variant="secondary">
                            {productMap[s.product_id]?.name ?? s.product_id}
                          </Badge>
                        ) : (
                          <span className="text-slate-500 text-xs">{EM_DASH}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{s.reason ?? EM_DASH}</td>
                      <td className="px-5 py-3">
                        <Badge variant={sourceVariant[s.source]}>
                          {suppressionSourceLabel(s.source)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {formatDate(s.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <RemoveSuppressionButton suppression={s} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && !error && sortedRows.length > 0 && (
        <TablePagination
          page={controls.page}
          pageSize={PAGE_SIZE}
          hasMore={hasMore}
          onPrev={controls.onPrev}
          onNext={controls.onNext}
        />
      )}

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <Button
          variant="destructive"
          size="sm"
          disabled={bulkUnblock.isPending}
          onClick={handleBulkUnblock}
        >
          {bulkUnblock.isPending ? (
            <>
              <Spinner /> Unblocking
            </>
          ) : (
            'Unblock selected'
          )}
        </Button>
      </BulkActionBar>
    </>
  )
}

function useScopeControls() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortState<SuppressionSortKey>>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearSuppressionsSearchTimer(timerRef), [])

  function onSearch(value: string) {
    setSearchInput(value)
    setPage(1)
    scheduleSuppressionsSearchUpdate(timerRef, value, setDebouncedSearch)
  }

  function onToggleSort(key: SuppressionSortKey) {
    setSort((prev) => {
      if (prev === null || prev.key !== key) return { key, direction: 'asc' }
      if (prev.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
    setPage(1)
  }

  return {
    searchInput,
    debouncedSearch,
    page,
    sort,
    onSearch,
    onToggleSort,
    onPrev: () => setPage((p) => Math.max(1, p - 1)),
    onNext: () => setPage((p) => p + 1),
  }
}

function useSuppressionsQuery(scope: SuppressionScope, q: string, page: number) {
  const params: SuppressionsQuery = {
    scope,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }
  return useQuery({
    queryKey: queryKeys.suppressions({
      scope,
      q: q || undefined,
      page,
    }),
    queryFn: () => getSuppressions(params),
    placeholderData: (prev) => prev,
  })
}

export function SuppressionsPage() {
  const globalControls = useScopeControls()
  const productControls = useScopeControls()

  const {
    data: globalSuppressions,
    isLoading: globalLoading,
    error: globalError,
    refetch: refetchGlobalSuppressions,
    isFetching: globalFetching,
  } = useSuppressionsQuery('global', globalControls.debouncedSearch, globalControls.page)

  const {
    data: productSuppressions,
    isLoading: productLoading,
    error: productError,
    refetch: refetchProductSuppressions,
    isFetching: productFetching,
  } = useSuppressionsQuery('product', productControls.debouncedSearch, productControls.page)

  const { data: products } = useQuery({
    queryKey: queryKeys.products(),
    queryFn: getProducts,
  })

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('scope') === 'product' ? 'product' : 'global') as
    | 'global'
    | 'product'

  function handleTabChange(value: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('scope', value)
      return params
    })
  }

  const global = globalSuppressions ?? []
  const perProduct = productSuppressions ?? []
  const productOptions = buildSuppressionProductOptions(products, perProduct)
  const refetchSuppressions = () => {
    void refetchGlobalSuppressions()
    void refetchProductSuppressions()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Block list</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Showing up to 100 recent blocks in each tab.
          </p>
        </div>
        <AddSuppressionDialog products={productOptions} />
      </div>

      {/* Keep the tab bar mounted while data loads so the table area does not
          jump down when the tabs appear; each tab shows its own skeleton. */}
      {globalError && productError && (
        <QueryError
          title="We could not load the block list."
          error={globalError}
          onRetry={refetchSuppressions}
          isRetrying={globalFetching || productFetching}
        />
      )}
      {globalError && !productError && (
        <QueryError
          title="We could not load the all-products list."
          error={globalError}
          onRetry={() => void refetchGlobalSuppressions()}
          isRetrying={globalFetching}
        />
      )}
      {productError && !globalError && (
        <QueryError
          title="We could not load the one-product list."
          error={productError}
          onRetry={() => void refetchProductSuppressions()}
          isRetrying={productFetching}
        />
      )}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="global">All products ({global.length})</TabsTrigger>
          <TabsTrigger value="product">One product ({perProduct.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="global" className="space-y-4">
          <SuppressionTabPanel
            scope="global"
            rows={global}
            products={products ?? []}
            isLoading={globalLoading}
            error={globalError}
            onRetry={() => void refetchGlobalSuppressions()}
            isFetching={globalFetching}
            controls={globalControls}
          />
        </TabsContent>
        <TabsContent value="product" className="space-y-4">
          <SuppressionTabPanel
            scope="product"
            rows={perProduct}
            products={products ?? []}
            isLoading={productLoading}
            error={productError}
            onRetry={() => void refetchProductSuppressions()}
            isFetching={productFetching}
            controls={productControls}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
