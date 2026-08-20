import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, SearchX, Trash2, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { CopyButton } from '../components/ui/copy-button'
import { ExportButton } from '../components/ui/data-export'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { ALL_PRODUCTS, ProductFilter } from '../components/ui/product-filter'
import { QueryError } from '../components/ui/query-error'
import { Select, SelectItem } from '../components/ui/select'
import { Sheet, SheetContent, SheetTrigger } from '../components/ui/sheet'
import { Skeleton, TableSkeleton } from '../components/ui/skeleton'
import { SortableHeader } from '../components/ui/sortable-header'
import { Spinner } from '../components/ui/spinner'
import { TablePagination } from '../components/ui/table-pagination'
import { TableToolbar } from '../components/ui/toolbar'
import {
  createContact,
  deleteContact,
  getContactDetail,
  getContacts,
  getProducts,
  getSequences,
  updateContact,
} from '../lib/api'
import type { CsvColumn } from '../lib/csv'
import { EM_DASH, formatDate, formatDateTime } from '../lib/dates'
import {
  formatPropertyValue,
  humanizeToken,
  membershipStatusLabel,
  runStatusLabel,
  sequenceLabel,
} from '../lib/labels'
import { queryKeys } from '../lib/queryKeys'
import type { ContactDetail, ContactRow, ProductRow } from '../lib/types'
import type { SortState } from '../lib/use-sortable-data'

const PAGE_SIZE = 50
const ALL_ACTIVE_SEQUENCES = 'all'

type ContactSortKey = 'email' | 'name' | 'created_at'

const CSV_COLUMNS: CsvColumn<ContactRow>[] = [
  { header: 'Email', accessor: (row) => row.email },
  {
    header: 'Name',
    accessor: (row) => [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
  },
  {
    header: 'Products',
    accessor: (row) => row.memberships.map((m) => m.product_name).join('; ') || null,
  },
  {
    header: 'Sequence',
    accessor: (row) =>
      row.active_runs.length > 0
        ? sequenceLabel(row.active_runs[0].sequence_slug, row.active_runs[0].product_slug)
        : null,
  },
  { header: 'Created', accessor: (row) => row.created_at },
]

function statusVariant(status: ContactRow['memberships'][number]['status']) {
  if (status === 'active') return 'success'
  if (status === 'unsubscribed') return 'outline'
  if (status === 'complained' || status === 'bounced') return 'destructive'
  return 'secondary'
}

type ContactSheetBodyProps = {
  contact: ContactRow
  detail?: ContactDetail
  detailError: unknown
  detailLoading: boolean
  detailFetching: boolean
  onRetry: () => void
}

export function ContactSheetBody({
  contact,
  detail,
  detailError,
  detailLoading,
  detailFetching,
  onRetry,
}: ContactSheetBodyProps) {
  const displayContact = detail ?? contact
  const displayName =
    [displayContact.first_name, displayContact.last_name].filter(Boolean).join(' ') ||
    displayContact.email
  const runs = detail?.runs ?? []
  const terminalRuns = runs.filter(
    (run) => run.status === 'completed' || run.status === 'exited' || run.status === 'errored',
  )
  const pausedRuns = runs.filter((run) => run.status === 'paused')
  const timeline = detail?.timeline ?? []
  const membershipSlugs = displayContact.memberships.map((m) => m.product_slug)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <User size={20} />
        </span>
        <div>
          <p className="font-semibold text-slate-900">{displayName}</p>
          <p className="text-sm text-slate-500">{displayContact.email}</p>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Created</p>
          <p className="text-slate-700">{formatDateTime(displayContact.created_at)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Products</p>
          {displayContact.memberships.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {displayContact.memberships.map((membership) => (
                <Badge
                  key={membership.product_id}
                  variant={statusVariant(membership.status)}
                  className="max-w-full break-all"
                >
                  {membership.product_name} - {membershipStatusLabel(membership.status)}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-slate-500">No products</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">
            {displayContact.active_runs.length > 1 ? 'Active Sequences' : 'Active Sequence'}
          </p>
          {displayContact.active_runs.length > 0 ? (
            <div className="space-y-2">
              {displayContact.active_runs.map((run) => (
                <div key={run.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="break-all text-slate-700">
                      {sequenceLabel(run.sequence_slug, run.product_slug)}
                    </p>
                    {(run.product_name ?? run.product_slug) && (
                      <Badge variant="secondary" className="shrink-0">
                        {run.product_name ?? run.product_slug}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Step {run.current_step_index + 1} - started {formatDateTime(run.started_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500">Not in a sequence</p>
          )}
        </div>
        {displayContact.properties && Object.keys(displayContact.properties).length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase mb-1">Other details</p>
            <dl className="divide-y divide-slate-100 rounded border border-slate-200">
              {Object.entries(displayContact.properties).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-slate-500">{humanizeToken(key)}</dt>
                  <dd className="break-all text-right text-slate-700">
                    {formatPropertyValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Reference</p>
          <div className="flex items-center gap-1.5">
            <p className="font-mono text-xs text-slate-500 break-all">{displayContact.id}</p>
            <CopyButton value={displayContact.id} label="Copy reference" />
          </div>
          <p className="mt-1 text-xs text-slate-500">Share this if you contact support.</p>
        </div>
      </div>

      {pausedRuns.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Paused Sequences</p>
          <div className="space-y-3">
            {pausedRuns.map((run) => (
              <div key={run.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium text-slate-800">
                      {sequenceLabel(run.sequence_slug, membershipSlugs)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Paused at step {run.current_step_index + 1} - started{' '}
                      {formatDateTime(run.started_at)}
                    </p>
                  </div>
                  <Badge variant="secondary">Paused</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500 uppercase">Sequence History</p>
          {detailFetching && <span className="text-xs text-slate-500">Refreshing</span>}
        </div>
        {detailLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded border border-slate-200 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-3 w-56" />
              </div>
            ))}
          </div>
        ) : detailError ? (
          <QueryError
            title="Failed to load contact history"
            error={detailError}
            onRetry={onRetry}
            isRetrying={detailFetching}
          />
        ) : terminalRuns.length === 0 ? (
          <p className="text-sm text-slate-500">No finished sequences yet.</p>
        ) : (
          <div className="space-y-3">
            {terminalRuns.map((run) => (
              <div key={run.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium text-slate-800">
                      {sequenceLabel(run.sequence_slug, membershipSlugs)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {runStatusLabel(run.status)} - started {formatDateTime(run.started_at)}
                    </p>
                  </div>
                  <Badge variant={run.status === 'completed' ? 'success' : 'secondary'}>
                    {runStatusLabel(run.status)}
                  </Badge>
                </div>
                {run.steps.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {run.steps.map((step) => (
                      <div key={step.id} className="border-l border-slate-200 pl-3">
                        <p className="text-xs font-medium text-slate-600">
                          Step {step.step_index + 1} - {humanizeToken(step.status)}
                        </p>
                        {step.message?.subject && (
                          <p className="break-all text-xs text-slate-500">{step.message.subject}</p>
                        )}
                        {step.events.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {step.events.map((event) => (
                              <Badge key={event.id} variant="outline">
                                {humanizeToken(event.type)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {timeline.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Timeline</p>
          <div className="space-y-1.5">
            {timeline.slice(-12).map((entry, index) => (
              <div
                key={`${entry.kind}-${entry.at}-${index}`}
                className="flex items-start justify-between gap-3 text-xs"
              >
                <span className="break-all text-slate-600">{humanizeToken(entry.kind)}</span>
                <span className="shrink-0 text-slate-500">{formatDateTime(entry.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ContactSheet({ contact }: { contact: ContactRow }) {
  const [open, setOpen] = useState(false)
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    refetch,
    isFetching: detailFetching,
  } = useQuery({
    queryKey: queryKeys.contactDetail(contact.id),
    queryFn: () => getContactDetail(contact.id),
    enabled: open,
  })

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto p-0 text-sm text-blue-700 hover:underline hover:bg-transparent"
        >
          {contact.email}
        </Button>
      </SheetTrigger>
      <SheetContent
        title="Contact Details"
        description="See this person's email, products, and sequence history."
      >
        <ContactSheetBody
          contact={contact}
          detail={detail}
          detailError={detailError}
          detailLoading={detailLoading}
          detailFetching={detailFetching}
          onRetry={() => void refetch()}
        />
      </SheetContent>
    </Sheet>
  )
}

function DeleteContactDialog({
  contact,
  onDelete,
  isDeleting,
}: {
  contact: ContactRow
  onDelete: (contact: ContactRow) => void
  isDeleting: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive-outline"
          size="sm"
          aria-label="Delete contact"
          title={`Delete ${contact.email}`}
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        title="Delete contact"
        description={`Delete ${contact.email} and its sequence history from Sequencer.`}
      >
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={() => onDelete(contact)}
            >
              Delete contact
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type ContactsSearchTimerRef = {
  current: ReturnType<typeof setTimeout> | null
}

type ContactFormDialogProps =
  | {
      mode: 'create'
      products: ProductRow[]
    }
  | {
      mode: 'edit'
      contact: ContactRow
      products?: never
    }

function ContactFormDialog(props: ContactFormDialogProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [productId, setProductId] = useState('none')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isCreate = props.mode === 'create'

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        email: email.trim(),
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
      }
      if (isCreate) {
        return createContact({
          ...payload,
          product_id: productId === 'none' ? null : productId,
        })
      }
      return updateContact(props.contact.id, payload)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contacts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.all() }),
      ])
      toast.success(isCreate ? 'Contact created' : 'Contact updated')
      setOpen(false)
      setSubmitError(null)
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save contact')
    },
  })

  function resetForm() {
    if (isCreate) {
      setEmail('')
      setFirstName('')
      setLastName('')
      setProductId('none')
    } else {
      setEmail(props.contact.email)
      setFirstName(props.contact.first_name ?? '')
      setLastName(props.contact.last_name ?? '')
    }
    setSubmitError(null)
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm()
    setOpen(next)
  }

  function handleSubmit() {
    if (!email.trim()) {
      setSubmitError('Email is required')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {isCreate ? (
          <Button size="sm" className="gap-1.5">
            <Plus size={14} /> New contact
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            aria-label="Edit contact"
            title={`Edit ${props.contact.email}`}
          >
            <Pencil size={13} /> Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={isCreate ? 'New contact' : `Edit: ${props.contact.email}`}
        description="Set the contact details used in the dashboard."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor={`${isCreate ? 'new' : props.contact.id}-contact-email`}
              className="text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <Input
              id={`${isCreate ? 'new' : props.contact.id}-contact-email`}
              data-autofocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor={`${isCreate ? 'new' : props.contact.id}-contact-first`}
                className="text-sm font-medium text-slate-700"
              >
                First name
              </label>
              <Input
                id={`${isCreate ? 'new' : props.contact.id}-contact-first`}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`${isCreate ? 'new' : props.contact.id}-contact-last`}
                className="text-sm font-medium text-slate-700"
              >
                Last name
              </label>
              <Input
                id={`${isCreate ? 'new' : props.contact.id}-contact-last`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          {isCreate && (
            <div className="space-y-1.5">
              <label htmlFor="new-contact-product" className="text-sm font-medium text-slate-700">
                Product
              </label>
              <Select
                id="new-contact-product"
                aria-label="Product"
                value={productId}
                onValueChange={setProductId}
                className="w-full"
              >
                <SelectItem value="none">No product</SelectItem>
                {props.products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          )}
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
            <Button size="sm" type="button" onClick={handleSubmit} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Spinner /> Saving
                </>
              ) : isCreate ? (
                'Create contact'
              ) : (
                'Save contact'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function clearContactsSearchTimer(timerRef: ContactsSearchTimerRef) {
  if (timerRef.current) {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

export function scheduleContactsSearchUpdate(
  timerRef: ContactsSearchTimerRef,
  value: string,
  updateSearch: (value: string) => void,
) {
  clearContactsSearchTimer(timerRef)
  timerRef.current = setTimeout(() => {
    timerRef.current = null
    updateSearch(value)
  }, 300)
}

export function ContactsPage() {
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [product, setProduct] = useState(ALL_PRODUCTS)
  const [activeSequence, setActiveSequence] = useState(ALL_ACTIVE_SEQUENCES)
  const [page, setPage] = useState(1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearContactsSearchTimer(timerRef), [])

  function handleSearch(value: string) {
    setSearchInput(value)
    setPage(1)
    scheduleContactsSearchUpdate(timerRef, value, setDebouncedSearch)
  }

  function handleProductChange(slug: string) {
    setProduct(slug)
    setPage(1)
  }

  function handleActiveSequenceChange(value: string) {
    setActiveSequence(value)
    setPage(1)
  }

  const productParam = product === ALL_PRODUCTS ? undefined : product
  const activeSequenceParam = activeSequence === ALL_ACTIVE_SEQUENCES ? undefined : activeSequence

  const { data: products } = useQuery({
    queryKey: queryKeys.products(),
    queryFn: getProducts,
  })
  const { data: sequences } = useQuery({
    queryKey: queryKeys.sequences(),
    queryFn: () => getSequences(),
  })

  const [sort, setSort] = useState<SortState<ContactSortKey>>(null)

  function toggleSort(key: ContactSortKey) {
    setSort((prev) => {
      if (prev === null || prev.key !== key) return { key, direction: 'asc' }
      if (prev.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
    setPage(1)
  }

  const sortField = sort?.key ?? undefined
  const sortDir = sort?.direction ?? undefined

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.contacts({
      q: debouncedSearch || undefined,
      product: productParam,
      active_sequence: activeSequenceParam,
      sort: sortField,
      dir: sortDir,
      page,
    }),
    queryFn: () =>
      getContacts({
        q: debouncedSearch || undefined,
        product: productParam,
        active_sequence: activeSequenceParam,
        sort: sortField,
        dir: sortDir,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  })
  const deleteMutation = useMutation({
    mutationFn: (contactId: string) => deleteContact(contactId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts() })
    },
  })

  const sortedRows = data ?? []
  const activeSequenceOptions = (sequences ?? [])
    .filter((sequence) => sequence.is_active)
    .map((sequence) => ({
      slug: sequence.slug,
      label: sequenceLabel(sequence.slug),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const hasMore = (data?.length ?? 0) === PAGE_SIZE

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Contacts</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Showing the latest 50 contacts across products. Search by name or email to find older
          ones.
        </p>
      </div>

      <TableToolbar
        actions={
          <>
            <ContactFormDialog mode="create" products={products ?? []} />
            <ExportButton<ContactRow>
              rows={sortedRows}
              columns={CSV_COLUMNS}
              filename="contacts.csv"
            />
          </>
        }
      >
        <div className="relative max-w-sm">
          <label htmlFor="contacts-search" className="sr-only">
            Search by name or email
          </label>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id="contacts-search"
            aria-label="Search contacts by name or email"
            placeholder="Search name or email..."
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <ProductFilter
          value={product}
          onChange={handleProductChange}
          products={products ?? []}
          aria-label="Filter by product"
        />

        <Select
          aria-label="Filter by active sequence"
          value={activeSequence}
          onValueChange={handleActiveSequenceChange}
          placeholder="Active sequence"
          className="w-52 rounded-full"
        >
          <SelectItem value={ALL_ACTIVE_SEQUENCES}>All sequences</SelectItem>
          <SelectItem value="any">Any active sequence</SelectItem>
          <SelectItem value="none">No active sequence</SelectItem>
          {activeSequenceOptions.map((sequence) => (
            <SelectItem key={sequence.slug} value={sequence.slug}>
              {sequence.label}
            </SelectItem>
          ))}
        </Select>
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
                title="Failed to load contacts"
                error={error}
                onRetry={() => void refetch()}
                isRetrying={isFetching}
              />
            </div>
          ) : !data || data.length === 0 ? (
            debouncedSearch || product !== ALL_PRODUCTS ? (
              <EmptyState
                icon={SearchX}
                title="No contacts found"
                description={
                  debouncedSearch
                    ? `No contacts matching "${debouncedSearch}". Try a different name or email.`
                    : 'No contacts match the selected filter.'
                }
              />
            ) : (
              <EmptyState
                icon={User}
                title="No contacts yet"
                description="Contacts show up here once a product enrolls them."
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" aria-label="Contacts">
                <thead>
                  <tr className="border-b border-slate-100">
                    <SortableHeader
                      field="email"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Email
                    </SortableHeader>
                    <SortableHeader
                      field="name"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Name
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Products
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">
                      Sequence
                    </th>
                    <SortableHeader
                      field="created_at"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase"
                    >
                      Created
                    </SortableHeader>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((contact) => {
                    const displayName =
                      [contact.first_name, contact.last_name].filter(Boolean).join(' ') || EM_DASH
                    return (
                      <tr
                        key={contact.id}
                        className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3">
                          <ContactSheet contact={contact} />
                        </td>
                        <td className="px-5 py-3 text-slate-600">{displayName}</td>
                        <td className="px-5 py-3">
                          {contact.memberships.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {contact.memberships.slice(0, 3).map((membership) => (
                                <Badge
                                  key={membership.product_id}
                                  variant={statusVariant(membership.status)}
                                  className="max-w-[8rem] truncate"
                                >
                                  {membership.product_name}
                                </Badge>
                              ))}
                              {contact.memberships.length > 3 && (
                                <Badge variant="secondary">+{contact.memberships.length - 3}</Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">No products</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {contact.active_runs.length > 0 ? (
                            <div className="max-w-xs">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="success">Running</Badge>
                                {contact.active_runs.length > 1 && (
                                  <Badge variant="secondary">
                                    +{contact.active_runs.length - 1}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 truncate text-xs text-slate-500">
                                {sequenceLabel(
                                  contact.active_runs[0].sequence_slug,
                                  contact.active_runs[0].product_slug,
                                )}{' '}
                                - step {contact.active_runs[0].current_step_index + 1}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">Not in a sequence</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {formatDate(contact.created_at)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <ContactFormDialog mode="edit" contact={contact} />
                            <DeleteContactDialog
                              contact={contact}
                              isDeleting={
                                deleteMutation.isPending && deleteMutation.variables === contact.id
                              }
                              onDelete={(selected) => deleteMutation.mutate(selected.id)}
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

      {data && data.length > 0 && (
        <TablePagination
          page={page}
          pageSize={PAGE_SIZE}
          hasMore={hasMore}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}
    </div>
  )
}
