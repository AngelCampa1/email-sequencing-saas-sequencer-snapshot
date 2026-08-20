import { useQuery } from '@tanstack/react-query'
import { Eye, RefreshCw, Search, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { ExportButton } from '../components/ui/data-export'
import { Dialog, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { ALL_PRODUCTS, ProductFilter } from '../components/ui/product-filter'
import { QueryError } from '../components/ui/query-error'
import { Skeleton } from '../components/ui/skeleton'
import { SortableHeader } from '../components/ui/sortable-header'
import { TableToolbar } from '../components/ui/toolbar'
import { apiFetchText, apiUrl, getTemplates } from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { sequenceLabel, templateKindLabel, templateLabel } from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { TemplateCatalogRow } from '../lib/types'
import type { SortableColumn } from '../lib/use-sortable-data'
import { useSortableData } from '../lib/use-sortable-data'

type TemplateSortKey = 'slug' | 'product' | 'kind' | 'usage_count'

const SORT_COLUMNS: SortableColumn<TemplateCatalogRow, TemplateSortKey>[] = [
  { key: 'slug', accessor: (row) => row.slug },
  { key: 'product', accessor: (row) => row.product_slug },
  { key: 'kind', accessor: (row) => row.kind },
  { key: 'usage_count', accessor: (row) => row.usage_count },
]

const CSV_COLUMNS: CsvColumn<TemplateCatalogRow>[] = [
  { header: 'Template', accessor: (row) => row.slug },
  { header: 'Product', accessor: (row) => row.product_name },
  { header: 'Type', accessor: (row) => templateKindLabel(row.kind) },
  { header: 'Uses', accessor: (row) => row.usage_count },
  {
    header: 'Sequences',
    accessor: (row) => row.sequences.map((s) => s.slug).join('; ') || null,
  },
]

function hasPreview(template: TemplateCatalogRow) {
  return template.renderable && template.preview_url.trim().length > 0
}

type PreviewFrameStatus = 'loading' | 'ready' | 'failed'

export function TemplatePreviewFrame({
  template,
  initialStatus = 'loading',
}: {
  template: TemplateCatalogRow
  initialStatus?: PreviewFrameStatus
}) {
  const [status, setStatus] = useState<PreviewFrameStatus>(initialStatus)
  const [reloadKey, setReloadKey] = useState(0)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional trigger for forced reload
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setPreviewError(null)
    setPreviewHtml('')

    apiFetchText(template.preview_url)
      .then((html) => {
        if (cancelled) return
        setPreviewHtml(html)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setPreviewError(
          error instanceof Error && error.message.trim() !== ''
            ? error.message
            : 'Preview endpoint failed',
        )
        setStatus('failed')
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey, template.preview_url])

  function retryPreview() {
    setStatus('loading')
    setReloadKey((current) => current + 1)
  }

  return (
    <div className="relative">
      {status === 'loading' && (
        <div className="absolute inset-x-0 top-0 z-10 rounded-t border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
          Loading preview...
        </div>
      )}
      {status === 'failed' ? (
        <div
          role="alert"
          className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-medium">Preview failed to load.</p>
          <p className="mt-1 text-xs">
            We could not build this preview right now. Please try again.
          </p>
          {previewError && <p className="mt-1 text-xs font-mono">{previewError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={retryPreview}>
              <RefreshCw size={13} /> Retry preview
            </Button>
            <a
              href={apiUrl(template.preview_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              Open endpoint
            </a>
          </div>
        </div>
      ) : (
        <iframe
          key={reloadKey}
          srcDoc={previewHtml}
          title={`Preview of ${template.slug}`}
          sandbox="allow-same-origin"
          className="w-full rounded border border-slate-200 bg-white"
          style={{ height: '480px' }}
        />
      )}
    </div>
  )
}

function TemplatePreviewDialog({ template }: { template: TemplateCatalogRow }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Eye size={13} /> Preview
        </Button>
      </DialogTrigger>
      <DialogContent
        title={templateLabel(template.slug, template.product_slug)}
        description={`${template.slug} · ${template.usage_count.toLocaleString()} use${template.usage_count === 1 ? '' : 's'} across ${template.sequences.length.toLocaleString()} sequence${template.sequences.length === 1 ? '' : 's'}`}
        className="max-w-3xl"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{template.product_name}</Badge>
            <Badge variant="outline">{templateKindLabel(template.kind)}</Badge>
            {template.source.legacy_key && (
              <code className="rounded bg-slate-100 px-2 py-0.5 text-slate-500 font-mono">
                {template.source.legacy_key}
              </code>
            )}
          </div>
          <TemplatePreviewFrame template={template} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function TemplatesPage() {
  const [product, setProduct] = useState<string>(ALL_PRODUCTS)
  const [search, setSearch] = useState('')
  const {
    data = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: getTemplates,
  })

  const products = useMemo(() => {
    const map = new Map<string, { id: string; slug: string; name: string }>()
    for (const t of data) {
      if (!map.has(t.product_slug)) {
        map.set(t.product_slug, { id: t.product_id, slug: t.product_slug, name: t.product_name })
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const query = search.trim().toLowerCase()
  const filtered = data.filter((template) => {
    if (product !== ALL_PRODUCTS && template.product_slug !== product) return false
    if (query === '') return true
    const haystack = [
      template.slug,
      template.product_name,
      templateLabel(template.slug, template.product_slug),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })

  const { sorted, sort, toggleSort } = useSortableData<TemplateCatalogRow, TemplateSortKey>(
    filtered,
    SORT_COLUMNS,
  )

  if (isLoading) {
    return (
      <div className="p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Email Templates</h1>
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <QueryError
          title="Failed to load templates"
          error={error}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Email Templates</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {data.length} templates across {products.length} products
        </p>
      </div>

      <TableToolbar
        actions={
          <ExportButton<TemplateCatalogRow>
            rows={sorted}
            columns={CSV_COLUMNS}
            filename="templates.csv"
          />
        }
      >
        <div className="relative max-w-sm">
          <label htmlFor="templates-search" className="sr-only">
            Search templates
          </label>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id="templates-search"
            aria-label="Search templates by name or product"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <ProductFilter
          value={product}
          onChange={setProduct}
          products={products}
          aria-label="Filter templates by product"
        />
      </TableToolbar>

      <Card>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <SearchX size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-600">No templates found</p>
              <p className="text-xs text-slate-500 mt-1">
                Try a different search or product filter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Email templates">
                <thead>
                  <tr className="border-b border-slate-100">
                    <SortableHeader
                      field="slug"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Template
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
                      field="kind"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Type
                    </SortableHeader>
                    <SortableHeader
                      field="usage_count"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase"
                    >
                      Uses
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Sequences
                    </th>
                    <th className="px-5 py-2.5 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((template) => (
                    <tr
                      key={`${template.product_id}:${template.slug}`}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <span className="block text-sm font-medium text-slate-800">
                          {templateLabel(template.slug, template.product_slug)}
                        </span>
                        <span className="block font-mono text-[11px] text-slate-500">
                          {template.slug}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="secondary">{template.product_name}</Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {templateKindLabel(template.kind)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {template.usage_count.toLocaleString()}
                      </td>
                      <td className="px-5 py-3">
                        <div className="max-w-72 truncate text-xs text-slate-500">
                          {template.sequences.length > 0 ? (
                            template.sequences.map((sequence, index) => (
                              <span key={sequence.slug}>
                                {index > 0 && ', '}
                                <Link
                                  to={`/sequences?q=${encodeURIComponent(sequence.slug)}`}
                                  className="text-blue-700 hover:underline"
                                >
                                  {sequenceLabel(sequence.slug, template.product_slug)}
                                </Link>
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-500">Not used yet</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {hasPreview(template) ? (
                          <TemplatePreviewDialog template={template} />
                        ) : (
                          <span className="text-xs text-slate-500">No preview</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
