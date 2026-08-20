import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Package, Pencil, Plus, Search, SearchX, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { ExportButton } from '../components/ui/data-export'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { QueryError } from '../components/ui/query-error'
import { Select, SelectItem } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { SortableHeader } from '../components/ui/sortable-header'
import { Spinner } from '../components/ui/spinner'
import { TableToolbar } from '../components/ui/toolbar'
import {
  createProduct,
  deleteProduct,
  getLeadMagnets,
  getProducts,
  getSequences,
  updateProduct,
} from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { queryKeys } from '../lib/queryKeys'
import type { ProductRow } from '../lib/types'
import type { SortableColumn } from '../lib/use-sortable-data'
import { useSortableData } from '../lib/use-sortable-data'

type CountStatus = 'ready' | 'loading' | 'unavailable'

const ALL_SCOPES = '__all_scopes__'

function scopeLabel(scope: ProductRow['suppression_scope']): string {
  return scope === 'global' ? 'Blocks all products' : 'Blocks this product only'
}

function formatCreated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

type ProductSortKey = 'name' | 'slug' | 'suppression_scope' | 'created_at'
type ProductFormMode = 'create' | 'edit'

const SORT_COLUMNS: SortableColumn<ProductRow, ProductSortKey>[] = [
  { key: 'name', accessor: (row) => row.name },
  { key: 'slug', accessor: (row) => row.slug },
  { key: 'suppression_scope', accessor: (row) => row.suppression_scope },
  { key: 'created_at', accessor: (row) => row.created_at },
]

const CSV_COLUMNS: CsvColumn<ProductRow>[] = [
  { header: 'Name', accessor: (row) => row.name },
  { header: 'Slug', accessor: (row) => row.slug },
  { header: 'From email', accessor: (row) => row.default_from_email },
  { header: 'Suppression scope', accessor: (row) => scopeLabel(row.suppression_scope) },
  { header: 'Created', accessor: (row) => formatCreated(row.created_at) },
]

function CountValue({ value, status }: { value: number; status: CountStatus }) {
  if (status === 'loading') {
    return <span className="text-xs font-semibold text-slate-500">Loading</span>
  }
  if (status === 'unavailable') {
    return <span className="text-xs font-semibold text-slate-500">Unavailable</span>
  }
  return <span className="text-sm font-semibold text-slate-900">{value.toLocaleString()}</span>
}

function ProductRowCells({
  product,
  products,
  sequences,
  leadMagnets,
  sequencesStatus,
  leadMagnetsStatus,
}: {
  product: ProductRow
  products: ProductRow[]
  sequences: Awaited<ReturnType<typeof getSequences>>
  leadMagnets: Awaited<ReturnType<typeof getLeadMagnets>>
  sequencesStatus: CountStatus
  leadMagnetsStatus: CountStatus
}) {
  const productSequences = sequences.filter((s) => s.product_id === product.id)
  const activeSequences = productSequences.filter((s) => s.is_active)
  const productLeadMagnets = leadMagnets.filter((lm) => lm.product_id === product.id)

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors align-top">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-7 w-7 rounded-lg shrink-0"
            style={{ backgroundColor: product.brand_color }}
          />
          <div className="min-w-0">
            <span className="block text-sm font-medium text-slate-800 truncate">
              {product.name}
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Mail size={11} className="text-slate-400" />
              <span className="font-mono truncate">{product.default_from_email}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {product.firewall_partner_id && (
            <Badge
              variant="warning"
              className="text-xs"
              title="We skip people who are already with its partner product."
            >
              Partner guard
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs font-normal">
            {product.resend_api_key_secret_name ? 'Email connected' : 'Email not set up'}
          </Badge>
        </div>
        {product.default_reply_to && (
          <p className="text-xs text-slate-500 pt-1">Reply-to: {product.default_reply_to}</p>
        )}
      </td>
      <td className="px-5 py-3 font-mono text-xs text-slate-500">{product.slug}</td>
      <td className="px-5 py-3">
        <Badge
          variant="outline"
          className="text-xs"
          title={
            product.suppression_scope === 'global'
              ? 'A block here stops emails from every product.'
              : 'A block here stops emails from this product only.'
          }
        >
          {scopeLabel(product.suppression_scope)}
        </Badge>
      </td>
      <td className="px-5 py-3 text-xs text-slate-500">{formatCreated(product.created_at)}</td>
      <td className="px-5 py-3">
        <div className="flex gap-3 text-center">
          <div>
            <CountValue value={activeSequences.length} status={sequencesStatus} />
            <span className="block text-[11px] text-slate-500">Active</span>
          </div>
          <div>
            <CountValue value={productSequences.length} status={sequencesStatus} />
            <span className="block text-[11px] text-slate-500">All seq</span>
          </div>
          <div>
            <CountValue value={productLeadMagnets.length} status={leadMagnetsStatus} />
            <span className="block text-[11px] text-slate-500">Magnets</span>
          </div>
        </div>
      </td>
      <td className="px-5 py-3">
        <div className="flex justify-end gap-2">
          <ProductFormDialog mode="edit" product={product} products={products} />
          <DeleteProductDialog product={product} />
        </div>
      </td>
    </tr>
  )
}

function emptyFormValues(): ProductFormValues {
  return {
    slug: '',
    name: '',
    brand_color: '#000000',
    default_from_email: '',
    default_reply_to: '',
    resend_api_key_secret_name: '',
    suppression_scope: 'product',
    firewall_partner_id: '',
  }
}

type ProductFormValues = {
  slug: string
  name: string
  brand_color: string
  default_from_email: string
  default_reply_to: string
  resend_api_key_secret_name: string
  suppression_scope: ProductRow['suppression_scope']
  firewall_partner_id: string
}

function productToFormValues(product: ProductRow): ProductFormValues {
  return {
    slug: product.slug,
    name: product.name,
    brand_color: product.brand_color,
    default_from_email: product.default_from_email,
    default_reply_to: product.default_reply_to ?? '',
    resend_api_key_secret_name: product.resend_api_key_secret_name,
    suppression_scope: product.suppression_scope,
    firewall_partner_id: product.firewall_partner_id ?? '',
  }
}

function productPayload(values: ProductFormValues) {
  return {
    slug: values.slug.trim(),
    name: values.name.trim(),
    brand_color: values.brand_color.trim() || '#000000',
    default_from_email: values.default_from_email.trim(),
    default_reply_to: values.default_reply_to.trim() === '' ? null : values.default_reply_to.trim(),
    resend_api_key_secret_name: values.resend_api_key_secret_name.trim(),
    suppression_scope: values.suppression_scope,
    firewall_partner_id: values.firewall_partner_id === '' ? null : values.firewall_partner_id,
  }
}

function ProductFormDialog({
  mode,
  product,
  products,
}: {
  mode: ProductFormMode
  product?: ProductRow
  products: ProductRow[]
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<ProductFormValues>(() =>
    product ? productToFormValues(product) : emptyFormValues(),
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = mode === 'edit'

  const mutation = useMutation({
    mutationFn: () =>
      isEdit && product
        ? updateProduct(product.id, productPayload(values))
        : createProduct(productPayload(values)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.products() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success(isEdit ? 'Product updated' : 'Product created')
      setSubmitError(null)
      setOpen(false)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save product')
    },
  })

  function handleOpenChange(next: boolean) {
    if (next) {
      setValues(product ? productToFormValues(product) : emptyFormValues())
      setSubmitError(null)
    }
    setOpen(next)
  }

  function setField<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate()
  }

  const triggerLabel = isEdit && product ? `Edit ${product.slug}` : 'New product'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={isEdit ? 'ghost' : 'default'} size="sm" aria-label={triggerLabel}>
          {isEdit ? <Pencil size={13} /> : <Plus size={13} />}
          {isEdit ? 'Edit' : 'New product'}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={isEdit && product ? `Edit: ${product.name}` : 'New product'}
        description="Set the product email defaults used by sequences."
        className="max-w-2xl"
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor={`product-name-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Name
              </label>
              <Input
                id={`product-name-${mode}-${product?.id ?? 'new'}`}
                data-autofocus
                value={values.name}
                onChange={(event) => setField('name', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-slug-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Slug
              </label>
              <Input
                id={`product-slug-${mode}-${product?.id ?? 'new'}`}
                value={values.slug}
                onChange={(event) => setField('slug', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-from-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                From email
              </label>
              <Input
                id={`product-from-${mode}-${product?.id ?? 'new'}`}
                value={values.default_from_email}
                onChange={(event) => setField('default_from_email', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-reply-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Reply-to email
              </label>
              <Input
                id={`product-reply-${mode}-${product?.id ?? 'new'}`}
                value={values.default_reply_to}
                onChange={(event) => setField('default_reply_to', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-secret-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Resend secret
              </label>
              <Input
                id={`product-secret-${mode}-${product?.id ?? 'new'}`}
                value={values.resend_api_key_secret_name}
                onChange={(event) => setField('resend_api_key_secret_name', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-color-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Brand color
              </label>
              <Input
                id={`product-color-${mode}-${product?.id ?? 'new'}`}
                type="color"
                value={values.brand_color}
                onChange={(event) => setField('brand_color', event.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-scope-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Suppression scope
              </label>
              <select
                id={`product-scope-${mode}-${product?.id ?? 'new'}`}
                value={values.suppression_scope}
                onChange={(event) =>
                  setField(
                    'suppression_scope',
                    event.target.value as ProductRow['suppression_scope'],
                  )
                }
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="product">Blocks this product only</option>
                <option value="global">Blocks all products</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`product-firewall-${mode}-${product?.id ?? 'new'}`}
                className="text-sm font-medium text-slate-700"
              >
                Partner guard
              </label>
              <select
                id={`product-firewall-${mode}-${product?.id ?? 'new'}`}
                value={values.firewall_partner_id}
                onChange={(event) => setField('firewall_partner_id', event.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">None</option>
                {products
                  .filter((candidate) => candidate.id !== product?.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </div>
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
              ) : isEdit ? (
                'Save product'
              ) : (
                'Create product'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteProductDialog({ product }: { product: ProductRow }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.products() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success('Product deleted')
      setSubmitError(null)
      setOpen(false)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to delete product')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive-outline" size="sm" aria-label={`Delete ${product.slug}`}>
          <Trash2 size={13} /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Delete: ${product.name}`}
        description="This only works when no sequence, contact, token, or message still uses it."
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Delete {product.name} from the dashboard?</p>
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
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Spinner /> Deleting
                </>
              ) : (
                'Delete product'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ProductsPage() {
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<string>(ALL_SCOPES)

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
    data: sequences,
    isLoading: sequencesLoading,
    error: sequencesError,
  } = useQuery({
    queryKey: queryKeys.sequences(),
    queryFn: () => getSequences(),
  })
  const {
    data: leadMagnets,
    isLoading: leadMagnetsLoading,
    error: leadMagnetsError,
  } = useQuery({
    queryKey: queryKeys.leadMagnets(),
    queryFn: getLeadMagnets,
  })
  const sequencesStatus: CountStatus = sequencesError
    ? 'unavailable'
    : sequencesLoading
      ? 'loading'
      : 'ready'
  const leadMagnetsStatus: CountStatus = leadMagnetsError
    ? 'unavailable'
    : leadMagnetsLoading
      ? 'loading'
      : 'ready'

  const allProducts = products ?? []

  const scopes = useMemo(() => {
    const present = new Set<ProductRow['suppression_scope']>()
    for (const p of allProducts) present.add(p.suppression_scope)
    return [...present].sort((a, b) => a.localeCompare(b))
  }, [allProducts])

  const query = search.trim().toLowerCase()
  const filtered = allProducts.filter((product) => {
    if (scope !== ALL_SCOPES && product.suppression_scope !== scope) return false
    if (query === '') return true
    const haystack = [product.name, product.slug, product.default_from_email]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })

  const { sorted, sort, toggleSort } = useSortableData<ProductRow, ProductSortKey>(
    filtered,
    SORT_COLUMNS,
  )

  const hasProducts = allProducts.length > 0

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
        <p className="text-sm text-slate-500 mt-0.5">Every Ventora product we run email for.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : error ? (
        <QueryError
          title="We could not load your products."
          error={error}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      ) : !hasProducts ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
          <Package size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-600">No products yet</p>
          <p className="text-xs text-slate-500 mt-1">Products show up here once they are added.</p>
        </div>
      ) : (
        <>
          <TableToolbar
            actions={
              <>
                <ProductFormDialog mode="create" products={allProducts} />
                <ExportButton<ProductRow>
                  rows={sorted}
                  columns={CSV_COLUMNS}
                  filename="products.csv"
                />
              </>
            }
          >
            <div className="relative max-w-sm">
              <label htmlFor="products-search" className="sr-only">
                Search products
              </label>
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                id="products-search"
                aria-label="Search products"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            <Select
              value={scope}
              onValueChange={setScope}
              aria-label="Filter products by suppression scope"
            >
              <SelectItem value={ALL_SCOPES}>All scopes</SelectItem>
              {scopes.map((s) => (
                <SelectItem key={s} value={s}>
                  {scopeLabel(s)}
                </SelectItem>
              ))}
            </Select>
          </TableToolbar>

          <Card>
            <CardContent className="p-0">
              {sorted.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <SearchX size={32} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-sm font-medium text-slate-600">No products found</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Try a different search or scope filter.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Products">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <SortableHeader
                          field="name"
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
                          field="suppression_scope"
                          sort={sort}
                          onToggle={toggleSort}
                          className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                        >
                          Scope
                        </SortableHeader>
                        <SortableHeader
                          field="created_at"
                          sort={sort}
                          onToggle={toggleSort}
                          className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                        >
                          Created
                        </SortableHeader>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                          Counts
                        </th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p) => (
                        <ProductRowCells
                          key={p.id}
                          product={p}
                          products={allProducts}
                          sequences={sequences ?? []}
                          leadMagnets={leadMagnets ?? []}
                          sequencesStatus={sequencesStatus}
                          leadMagnetsStatus={leadMagnetsStatus}
                        />
                      ))}
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
