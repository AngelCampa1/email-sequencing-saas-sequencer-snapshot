export interface OverviewData {
  send_volume_7d: number
  send_volume_30d: number
  active_runs: number
  unsub_rate_7d: number
  rot_sequences: string[]
  top_sequences: Array<{ slug: string; product: string; enrollments: number }>
  warm_summary: { total_sent_7d: number; avg_bounce_rate: number }
  cold_summary: { total_campaigns: number; total_sent_7d: number; reply_rate: number }
}

export interface SequenceRow {
  slug: string
  product_id: string
  version: number
  is_active: boolean
  goal?: string | null
  compiled_at: string
  compiled_from_sha?: string | null
  definition?: unknown
}

export interface ContactActiveRun {
  id: string
  product_id?: string | null
  product_slug?: string | null
  product_name?: string | null
  sequence_slug: string
  sequence_version: number
  status: 'running'
  current_step_index: number
  started_at: string
  enrollment_source: string
}

export interface ContactRow {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  properties?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  memberships: Array<{
    product_id: string
    product_slug: string
    product_name: string
    status: 'active' | 'unsubscribed' | 'bounced' | 'complained'
    created_at: string
    updated_at: string
  }>
  active_run: {
    id: string
    sequence_slug: string
    sequence_version: number
    status: 'running'
    current_step_index: number
    started_at: string
    enrollment_source: string
  } | null
  active_runs: ContactActiveRun[]
}

export interface ContactMessage {
  id: string
  step_id?: string | null
  contact_id: string
  product_id: string
  resend_message_id?: string | null
  subject?: string | null
  from_email?: string | null
  sent_at?: string | null
  delivered_at?: string | null
  opened_at?: string | null
  first_clicked_at?: string | null
  replied_at?: string | null
  bounced_at?: string | null
  complained_at?: string | null
  suppressed_at?: string | null
  failed_at?: string | null
  failure_reason?: string | null
  html_r2_key?: string | null
}

export interface ContactEvent {
  id: string
  provider: string
  message_id?: string | null
  type: string
  payload?: Record<string, unknown>
  received_at: string
}

export interface ContactStep {
  id: string
  run_id: string
  step_index: number
  template_slug?: string | null
  status: string
  scheduled_for?: string | null
  sent_at?: string | null
  message_id?: string | null
  message?: ContactMessage | null
  events: ContactEvent[]
}

export interface ContactRun {
  id: string
  sequence_slug: string
  sequence_version: number
  status: 'running' | 'completed' | 'exited' | 'errored' | 'paused'
  current_step_index: number
  enrollment_source?: string | null
  started_at: string
  completed_at?: string | null
  steps: ContactStep[]
}

export interface ContactTimelineEntry {
  kind: string
  at: string
  run_id?: string
  step_id?: string
  message_id?: string | null
  event_id?: string
  status?: string
  type?: string
}

export interface ContactDetail extends ContactRow {
  runs: ContactRun[]
  messages: ContactMessage[]
  events: ContactEvent[]
  timeline: ContactTimelineEntry[]
}

export interface SuppressionRow {
  id: string
  email: string
  scope: 'global' | 'product'
  product_id?: string | null
  reason?: string | null
  source:
    | 'manual'
    | 'webhook'
    | 'list_import'
    | 'complaint'
    | 'bounce'
    | 'suppression'
    | 'instantly_webhook'
  created_at: string
}

export interface ProductRow {
  id: string
  slug: string
  name: string
  brand_color: string
  default_from_email: string
  default_reply_to?: string | null
  resend_api_key_secret_name: string
  suppression_scope: 'global' | 'product'
  firewall_partner_id?: string | null
  created_at: string
  updated_at: string
}

export interface ApiTokenRow {
  id: string
  product_id: string
  product_slug: string
  product_name: string
  label: string
  access_service_token_id: string
  created_at: string
  revoked_at?: string | null
  active: boolean
}

export interface TemplateCatalogRow {
  slug: string
  product_id: string
  product_slug: string
  product_name: string
  kind: 'react-email' | 'legacy-camaudit'
  renderable: boolean
  preview_url: string
  usage_count: number
  sequences: Array<{
    slug: string
    version: number
    is_active: boolean
    step_ids: string[]
    subjects: string[]
  }>
  source: {
    legacy_key?: string
  }
}

export interface LeadMagnetRow {
  id: string
  product_id: string
  product_slug?: string
  product_name?: string
  slug: string
  name: string
  asset_r2_bucket?: string | null
  asset_r2_key?: string | null
  effective_asset_r2_bucket?: string | null
  asset_status?: 'available' | 'missing' | 'bucket_unbound' | 'not_configured' | 'unknown'
  asset_size?: number | null
  fulfillment_sequence_slug?: string | null
  conversion_event_name?: string | null
  active: boolean
  created_at: string
}

export interface DeliverabilityData {
  domains: Array<{
    id: string
    domain: string
    date: string
    sent: number
    delivered: number
    bounced: number
    complained: number
    opened: number
    clicked: number
    unsubscribed: number
  }>
  instantly_campaigns: Array<{
    id: string
    product_id?: string | null
    name: string
    status: string
    created_at_instantly?: string | null
    synced_at: string
  }>
}

export interface AuditEntry {
  id: string
  actor: string
  action: string
  target_type: string
  target_id?: string | null
  before?: unknown
  after?: unknown
  at: string
}

export interface AuditLogData {
  entries: AuditEntry[]
  has_next: boolean
}
