import type {
  EnrollmentRequest,
  EventRequest,
  ProductSlug,
  ProductUnsubscribeRequest,
  UpsertContactRequest,
} from '@sequencer/shared'

export interface SequencerClientOptions {
  baseUrl: string
  clientId: string
  clientSecret: string
}

export interface EventRequestOptions {
  idempotencyKey?: string
}

export interface LeadMagnetDownloadOptions {
  idempotencyKey?: string
}

export interface ContactResponse {
  id: string
  email: string
  is_new: boolean
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

export interface ContactTimelineStep extends Record<string, unknown> {
  id: string
  message?: Record<string, unknown> | null
  events?: Array<Record<string, unknown>>
}

export interface ContactTimelineRun extends Record<string, unknown> {
  id: string
  steps: ContactTimelineStep[]
}

export interface ContactTimelineResponse extends Record<string, unknown> {
  id: string
  email: string
  products: Array<Record<string, unknown>>
  runs: ContactTimelineRun[]
  messages: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  timeline: ContactTimelineEntry[]
}

export interface EnrollmentResponse {
  run_id: string
  status: 'enrolled' | 'already_running'
  variant?: string | null
}

export type EventResponse =
  | {
      ok: true
      event: string
      notified_runs: number
      transitioned_runs?: string[]
      duplicate?: boolean
      in_progress?: boolean
    }
  | {
      ok: false
      error: 'event_delivery_failed'
      event: string
      notified_runs: number
      failed_runs: string[]
    }

export type UnsubscribeResponse =
  | {
      ok: true
      email: string
      scope: 'product' | 'global'
      notified_runs: number
    }
  | {
      ok: false
      error: 'unsubscribe_delivery_failed'
      email: string
      scope: 'product' | 'global'
      notified_runs: number
      failed_runs: string[]
    }

export interface LeadMagnetDownloadRequest {
  email: string
  first_name?: string
  last_name?: string
  source?: string
  utm?: Record<string, string>
}

export type LeadMagnetDownloadResponse =
  | {
      ok: true
      asset_url: string
      run_id?: string | null
      status?: 'enrolled' | 'already_running' | 'no_sequence'
    }
  | {
      ok: false
      error: 'fulfillment_failed'
      detail: string
      asset_url: string
      run_id?: string | null
      status: 'fulfillment_failed'
    }
  | {
      ok: false
      error: 'conversion_event_delivery_failed'
      detail: string
      asset_url: string
      run_id?: string | null
      status?: 'enrolled' | 'already_running' | 'no_sequence'
      notified_runs: number
      failed_runs: string[]
    }

export class SequencerApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly detail?: unknown
  readonly responseBody?: unknown

  constructor(status: number, responseBody: unknown) {
    const code = isErrorBody(responseBody) ? responseBody.error : undefined
    const detail = isErrorBody(responseBody) ? responseBody.detail : undefined
    super(code ? `Sequencer API error ${status}: ${code}` : `Sequencer API error: ${status}`)
    this.name = 'SequencerApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.responseBody = responseBody
  }
}

export class SequencerClient {
  private readonly baseUrl: string

  constructor(private readonly opts: SequencerClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
  }

  async upsertContact(data: UpsertContactRequest): Promise<ContactResponse> {
    return this.fetch('/api/v1/contacts', { method: 'POST', body: JSON.stringify(data) })
  }

  async getContactTimeline(email: string): Promise<ContactTimelineResponse> {
    return this.fetch(`/api/v1/contacts/${encodeURIComponent(email)}`)
  }

  async enroll(data: EnrollmentRequest): Promise<EnrollmentResponse> {
    return this.fetch('/api/v1/enrollments', { method: 'POST', body: JSON.stringify(data) })
  }

  async fireEvent(data: EventRequest, options: EventRequestOptions = {}): Promise<EventResponse> {
    return this.fetch('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
    })
  }

  async unsubscribe(data: ProductUnsubscribeRequest): Promise<UnsubscribeResponse> {
    return this.fetch('/api/v1/unsubscribe', { method: 'POST', body: JSON.stringify(data) })
  }

  async downloadLeadMagnet(
    slug: string,
    data: LeadMagnetDownloadRequest,
    options: LeadMagnetDownloadOptions = {},
  ): Promise<LeadMagnetDownloadResponse> {
    return this.fetch(`/api/v1/lead-magnets/${encodeURIComponent(slug)}/download`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
    })
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': this.opts.clientId,
        'CF-Access-Client-Secret': this.opts.clientSecret,
        ...init?.headers,
      },
    })

    const body = await parseResponseBody(res)
    if (!res.ok) throw new SequencerApiError(res.status, body)
    return body as T
  }
}

export type { ProductSlug }

async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return text

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isErrorBody(body: unknown): body is { error: string; detail?: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'string'
  )
}
