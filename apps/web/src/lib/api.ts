import { ApiError } from './api-error'
import type {
  ApiTokenRow,
  AuditLogData,
  ContactDetail,
  ContactRow,
  DeliverabilityData,
  LeadMagnetRow,
  OverviewData,
  ProductRow,
  SequenceRow,
  SuppressionRow,
  TemplateCatalogRow,
} from './types'

// Thin fetch wrapper for the Sequencer API
const BASE = import.meta.env.VITE_API_URL ?? ''

export function apiUrl(path: string): string {
  return joinApiUrl(BASE, path)
}

export function joinApiUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (base === '') return normalizedPath

  return `${base.replace(/\/+$/, '')}${normalizedPath}`
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    // Pass the Cloudflare Access cookie along so the Worker sees Cf-Access-Authenticated-User-Email
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(formatApiError(error), res.status, error)
  }
  return res.json()
}

export async function apiFetchText(path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const error = await res
      .clone()
      .json()
      .catch(async () => ({ error: await res.text().catch(() => res.statusText) }))
    throw new ApiError(formatApiError(error), res.status, error)
  }
  return res.text()
}

function formatApiError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'API error'

  const record = error as Record<string, unknown>
  const title =
    typeof record.error === 'string' && record.error.trim() !== ''
      ? record.error.trim()
      : 'API error'
  const details = formatApiErrorDetails(record.detail ?? record.details)

  return details ? `${title}: ${details}` : title
}

function formatApiErrorDetails(details: unknown): string | null {
  if (typeof details === 'string') {
    const trimmed = details.trim()
    return trimmed === '' ? null : trimmed
  }

  if (!details || typeof details !== 'object') return null

  const record = details as Record<string, unknown>
  const fieldErrors = record.fieldErrors
  if (!fieldErrors || typeof fieldErrors !== 'object') return null

  const messages = Object.entries(fieldErrors as Record<string, unknown>).flatMap(
    ([field, value]) => formatFieldErrors(field, value),
  )

  return messages.length > 0 ? messages.join('; ') : null
}

function formatFieldErrors(field: string, value: unknown): string[] {
  if (typeof value === 'string' && value.trim() !== '') {
    return [`${field}: ${value.trim()}`]
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map((item) => `${field}: ${item.trim()}`)
  }

  return []
}

export async function getMe(): Promise<{ email: string; authenticated: boolean }> {
  return apiFetch('/me')
}

export async function getOverview(): Promise<OverviewData> {
  return apiFetch<OverviewData>('/api/internal/overview')
}

export async function getSequences(productSlug?: string): Promise<SequenceRow[]> {
  return apiFetch<SequenceRow[]>(
    `/api/internal/sequences${productSlug ? `?product=${productSlug}` : ''}`,
  )
}

export type SequencePatch = Pick<Partial<SequenceRow>, 'goal' | 'is_active' | 'definition'>

export type SequenceCreate = Pick<
  SequenceRow,
  'slug' | 'product_id' | 'definition' | 'is_active'
> & {
  goal?: string | null
  version?: number
}

export async function createSequence(data: SequenceCreate): Promise<SequenceRow> {
  return apiFetch<SequenceRow>('/api/internal/sequences', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateSequence(slug: string, data: SequencePatch): Promise<SequenceRow> {
  return apiFetch<SequenceRow>(`/api/internal/sequences/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteSequence(slug: string): Promise<{ ok: true }> {
  return apiFetch(`/api/internal/sequences/${encodeURIComponent(slug)}`, { method: 'DELETE' })
}

export type ContactSortField = 'email' | 'name' | 'created_at'
export type SortDir = 'asc' | 'desc'

export interface ContactsQuery {
  /** Free-text match against email, first name, or last name. */
  q?: string
  /** Product slug to restrict to contacts with a membership in that product. */
  product?: string
  /** Running sequence slug, or "any"/"none" for broad active-sequence filters. */
  active_sequence?: string
  sort?: ContactSortField
  dir?: SortDir
  limit?: number
  offset?: number
}

export async function getContacts(params?: ContactsQuery): Promise<ContactRow[]> {
  const parts: string[] = []
  if (params?.q) parts.push(`q=${encodeURIComponent(params.q)}`)
  if (params?.product) parts.push(`product=${encodeURIComponent(params.product)}`)
  if (params?.active_sequence)
    parts.push(`active_sequence=${encodeURIComponent(params.active_sequence)}`)
  if (params?.sort) parts.push(`sort=${params.sort}`)
  if (params?.dir) parts.push(`dir=${params.dir}`)
  if (params?.limit != null) parts.push(`limit=${params.limit}`)
  if (params?.offset != null) parts.push(`offset=${params.offset}`)
  const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
  return apiFetch<ContactRow[]>(`/api/internal/contacts${qs}`)
}

export async function getContactDetail(id: string): Promise<ContactDetail> {
  return apiFetch<ContactDetail>(`/api/internal/contacts/${encodeURIComponent(id)}`)
}

export async function deleteContact(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/internal/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export type ContactCreate = {
  email: string
  first_name?: string | null
  last_name?: string | null
  product_id?: string | null
}

export type ContactPatch = {
  email?: string
  first_name?: string | null
  last_name?: string | null
  properties?: Record<string, unknown> | null
}

export async function createContact(data: ContactCreate): Promise<ContactRow> {
  return apiFetch<ContactRow>('/api/internal/contacts', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateContact(id: string, data: ContactPatch): Promise<ContactRow> {
  return apiFetch<ContactRow>(`/api/internal/contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export interface SuppressionsQuery {
  scope?: 'global' | 'product'
  /** Free-text match against the suppressed email address. */
  q?: string
  limit?: number
  offset?: number
}

export async function getSuppressions(params?: SuppressionsQuery): Promise<SuppressionRow[]> {
  const parts: string[] = []
  if (params?.scope) parts.push(`scope=${params.scope}`)
  if (params?.q) parts.push(`q=${encodeURIComponent(params.q)}`)
  if (params?.limit != null) parts.push(`limit=${params.limit}`)
  if (params?.offset != null) parts.push(`offset=${params.offset}`)
  const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
  return apiFetch<SuppressionRow[]>(`/api/internal/suppressions${qs}`)
}

export async function getProducts(): Promise<ProductRow[]> {
  return apiFetch<ProductRow[]>('/api/internal/products')
}

export type ProductCreate = Pick<
  ProductRow,
  | 'slug'
  | 'name'
  | 'brand_color'
  | 'default_from_email'
  | 'default_reply_to'
  | 'resend_api_key_secret_name'
  | 'suppression_scope'
  | 'firewall_partner_id'
>

export type ProductPatch = Partial<ProductCreate>

export async function createProduct(data: ProductCreate): Promise<ProductRow> {
  return apiFetch<ProductRow>('/api/internal/products', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateProduct(id: string, data: ProductPatch): Promise<ProductRow> {
  return apiFetch<ProductRow>(`/api/internal/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteProduct(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/internal/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getApiTokens(): Promise<ApiTokenRow[]> {
  return apiFetch<ApiTokenRow[]>('/api/internal/api-tokens')
}

export async function createApiToken(data: {
  product_id: string
  label?: string
  access_service_token_id: string
}): Promise<{ ok: true; token: ApiTokenRow }> {
  return apiFetch('/api/internal/api-tokens', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function revokeApiToken(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/internal/api-tokens/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  })
}

export async function getTemplates(): Promise<TemplateCatalogRow[]> {
  return apiFetch<TemplateCatalogRow[]>('/api/internal/templates')
}

export async function getLeadMagnets(): Promise<LeadMagnetRow[]> {
  return apiFetch<LeadMagnetRow[]>('/api/internal/lead-magnets')
}

export async function getDeliverability(): Promise<DeliverabilityData> {
  return apiFetch<DeliverabilityData>('/api/internal/deliverability')
}

export async function updateInstantlyCampaign(
  id: string,
  data: { product_id: string | null },
): Promise<unknown> {
  return apiFetch(`/api/internal/deliverability/instantly-campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function createLeadMagnet(
  data: Partial<LeadMagnetRow> & { product_id: string; slug: string; name: string },
): Promise<LeadMagnetRow> {
  return apiFetch<LeadMagnetRow>('/api/internal/lead-magnets', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateLeadMagnet(
  id: string,
  data: Partial<LeadMagnetRow>,
): Promise<LeadMagnetRow> {
  return apiFetch<LeadMagnetRow>(`/api/internal/lead-magnets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteLeadMagnet(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/internal/lead-magnets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface AuditQuery {
  page?: number
  /** Exact actor match (email, 'system', or 'api:<product>'). */
  actor?: string
  /** Exact action match (e.g. 'suppression.removed'). */
  action?: string
  /** Inclusive lower bound on the entry timestamp (ISO date or datetime). */
  from?: string
  /** Inclusive upper bound on the entry timestamp (ISO date or datetime). */
  to?: string
}

export async function getAuditLog(params?: number | AuditQuery): Promise<AuditLogData> {
  const opts: AuditQuery = typeof params === 'number' ? { page: params } : (params ?? {})
  const parts: string[] = [`page=${opts.page ?? 1}`]
  if (opts.actor) parts.push(`actor=${encodeURIComponent(opts.actor)}`)
  if (opts.action) parts.push(`action=${encodeURIComponent(opts.action)}`)
  if (opts.from) parts.push(`from=${encodeURIComponent(opts.from)}`)
  if (opts.to) parts.push(`to=${encodeURIComponent(opts.to)}`)
  return apiFetch<AuditLogData>(`/api/internal/audit?${parts.join('&')}`)
}

export async function addSuppression(data: {
  email: string
  scope: 'global' | 'product'
  product_id?: string
  reason?: string
}): Promise<void> {
  return apiFetch('/api/internal/suppressions', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeSuppression(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/internal/suppressions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
