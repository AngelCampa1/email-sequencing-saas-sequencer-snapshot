import { createLogger } from '../lib/observability'
import type { Env } from '../types'

const ERROR_BODY_PREVIEW_LIMIT = 200

export interface InstantlyCampaign {
  id: string
  name: string
  status: string
  created_at?: string
}

export interface InstantlyCampaignStats {
  campaign_id: string
  date: string
  sent: number
  opened: number
  replied: number
  interested: number
  bounced: number
}

interface InstantlyLead {
  id: string
  email: string
  campaign?: string
  payload?: Record<string, unknown>
}

export class InstantlyAdapter {
  private logger: ReturnType<typeof createLogger>

  constructor(
    private apiKey: string,
    private env: Env,
  ) {
    this.logger = createLogger(env, { provider: 'instantly' })
  }

  async listCampaigns(): Promise<InstantlyCampaign[]> {
    const campaigns: InstantlyCampaign[] = []
    let startingAfter: string | null = null
    do {
      const params = new URLSearchParams({ limit: '100' })
      if (startingAfter) params.set('starting_after', startingAfter)
      const url = `https://api.instantly.ai/api/v2/campaigns?${params.toString()}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!res.ok) {
        const body = await readFailurePreview(res)
        this.logger.warn('Instantly listCampaigns failed', { status: res.status, body })
        throw new Error(`Instantly listCampaigns failed with ${res.status}: ${body}`)
      }
      const data = (await res.json()) as unknown
      campaigns.push(...parseCampaignListPayload(data))
      startingAfter = nextCampaignCursor(data)
    } while (startingAfter)

    return campaigns
  }

  async getCampaignAnalytics(campaignId: string, date: string): Promise<InstantlyCampaignStats> {
    const params = new URLSearchParams({ id: campaignId, start_date: date, end_date: date })
    const url = `https://api.instantly.ai/api/v2/campaigns/analytics?${params.toString()}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!res.ok) {
      const body = await readFailurePreview(res)
      this.logger.warn('Instantly getAnalytics failed', {
        status: res.status,
        campaign_id: campaignId,
        body,
      })
      throw new Error(
        `Instantly getAnalytics failed with ${res.status} for campaign ${campaignId}: ${body}`,
      )
    }
    const data = (await res.json()) as unknown
    const stats = parseCampaignAnalyticsPayload(data)
    return {
      campaign_id: campaignId,
      date,
      sent: stats.total_sent,
      opened: stats.total_opened,
      replied: stats.total_replied,
      interested: stats.total_interested,
      bounced: stats.total_bounced,
    }
  }

  async markConvertedSignup(input: {
    email: string
    product: string
    event: string
    properties?: Record<string, unknown>
  }): Promise<{ leadsUpdated: number; moveJobsStarted: number }> {
    const email = input.email.trim().toLowerCase()
    if (!email) return { leadsUpdated: 0, moveJobsStarted: 0 }

    const campaigns = await this.searchCampaignsByContact(email)
    const leadById = new Map<string, InstantlyLead>()

    for (const campaign of campaigns) {
      const campaignId = campaign.id
      const leads = await this.listLeadsByEmail(email, campaignId)
      for (const lead of leads) leadById.set(lead.id, lead)
    }

    if (leadById.size === 0) {
      const leads = await this.listLeadsByEmail(email)
      for (const lead of leads) leadById.set(lead.id, lead)
    }

    let leadsUpdated = 0
    for (const lead of leadById.values()) {
      await this.patchLead(lead.id, {
        custom_variables: {
          ...(lead.payload ?? {}),
          ventora_signup_completed: true,
          ventora_signup_product: input.product,
          ventora_signup_event: input.event,
          ventora_signup_at: new Date().toISOString(),
          ...(input.properties?.ve_campaign_id
            ? { ventora_signup_ve_campaign_id: input.properties.ve_campaign_id }
            : {}),
        },
      })
      leadsUpdated++
    }

    let moveJobsStarted = 0
    const convertedListId = this.env.INSTANTLY_CONVERTED_SIGNUPS_LIST_ID?.trim()
    if (convertedListId) {
      for (const campaign of campaigns) {
        const ids = [...leadById.values()]
          .filter((lead) => lead.campaign === campaign.id)
          .map((lead) => lead.id)
        if (ids.length === 0) continue
        await this.moveLeadsToList({
          campaignId: campaign.id,
          leadIds: ids,
          listId: convertedListId,
        })
        moveJobsStarted++
      }
    } else if (campaigns.length > 0) {
      this.logger.warn('Instantly converted signup list is not configured; lead was tagged only', {
        email,
        campaigns: campaigns.length,
      })
    }

    return { leadsUpdated, moveJobsStarted }
  }

  private async searchCampaignsByContact(email: string): Promise<InstantlyCampaign[]> {
    const params = new URLSearchParams({ search: email })
    const data = await this.instantlyJson(
      `https://api.instantly.ai/api/v2/campaigns/search-by-contact?${params.toString()}`,
      { method: 'GET' },
      'searchCampaignsByContact',
    )
    return parseCampaignListPayload(data)
  }

  private async listLeadsByEmail(email: string, campaignId?: string): Promise<InstantlyLead[]> {
    const body: Record<string, unknown> = { contacts: [email], limit: 100 }
    if (campaignId) body.campaign = campaignId
    const data = await this.instantlyJson(
      'https://api.instantly.ai/api/v2/leads/list',
      { method: 'POST', body: JSON.stringify(body) },
      'listLeads',
    )
    return parseLeadListPayload(data)
  }

  private async patchLead(leadId: string, body: Record<string, unknown>): Promise<void> {
    await this.instantlyJson(
      `https://api.instantly.ai/api/v2/leads/${encodeURIComponent(leadId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      'patchLead',
    )
  }

  private async moveLeadsToList(input: {
    campaignId: string
    leadIds: string[]
    listId: string
  }): Promise<void> {
    await this.instantlyJson(
      'https://api.instantly.ai/api/v2/leads/move',
      {
        method: 'POST',
        body: JSON.stringify({
          campaign: input.campaignId,
          ids: input.leadIds,
          to_list_id: input.listId,
          copy_leads: false,
          reset_interest_status: false,
        }),
      },
      'moveLeadsToList',
    )
  }

  private async instantlyJson(url: string, init: RequestInit, action: string): Promise<unknown> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!res.ok) {
      const body = await readFailurePreview(res)
      this.logger.warn(`Instantly ${action} failed`, { status: res.status, body })
      throw new Error(`Instantly ${action} failed with ${res.status}: ${body}`)
    }
    return res.json()
  }
}

function parseCampaignListPayload(data: unknown): InstantlyCampaign[] {
  if (Array.isArray(data)) return normalizeCampaignRows(data)
  if (isRecord(data) && Array.isArray(data.campaigns)) return normalizeCampaignRows(data.campaigns)
  if (isRecord(data) && Array.isArray(data.items)) return normalizeCampaignRows(data.items)
  throw new Error('Instantly listCampaigns returned an unexpected payload shape')
}

function nextCampaignCursor(data: unknown): string | null {
  if (!isRecord(data)) return null
  return typeof data.next_starting_after === 'string' && data.next_starting_after.length > 0
    ? data.next_starting_after
    : null
}

function normalizeCampaignRows(rows: unknown[]): InstantlyCampaign[] {
  return rows.map((row) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      throw new Error('Instantly listCampaigns returned an unexpected payload shape')
    }
    const rawStatus = row.status
    if (typeof rawStatus !== 'string' && typeof rawStatus !== 'number') {
      throw new Error('Instantly listCampaigns returned an unexpected payload shape')
    }
    return {
      id: row.id,
      name: row.name,
      status: String(rawStatus),
      created_at:
        typeof row.created_at === 'string'
          ? row.created_at
          : typeof row.timestamp_created === 'string'
            ? row.timestamp_created
            : undefined,
    }
  })
}

function parseLeadListPayload(data: unknown): InstantlyLead[] {
  if (!isRecord(data) || !Array.isArray(data.items)) {
    throw new Error('Instantly listLeads returned an unexpected payload shape')
  }
  return data.items.map((row) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.email !== 'string') {
      throw new Error('Instantly listLeads returned an unexpected payload shape')
    }
    return {
      id: row.id,
      email: row.email,
      campaign: typeof row.campaign === 'string' ? row.campaign : undefined,
      payload: isRecord(row.payload) ? row.payload : undefined,
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCampaignAnalyticsPayload(data: unknown): {
  total_sent: number
  total_opened: number
  total_replied: number
  total_interested: number
  total_bounced: number
} {
  if (Array.isArray(data) && data.length === 0) {
    return zeroCampaignAnalytics()
  }

  const record = Array.isArray(data)
    ? data.find((row): row is Record<string, unknown> => isRecord(row))
    : data
  if (!isRecord(record)) {
    throw new Error('Instantly getAnalytics returned an unexpected payload shape')
  }
  if (!hasAnyAnalyticsMetric(record)) {
    throw new Error('Instantly getAnalytics returned an unexpected payload shape')
  }

  return {
    total_sent: readOptionalMetric(record, 'total_sent', 'emails_sent_count'),
    total_opened: readOptionalMetric(record, 'total_opened', 'open_count'),
    total_replied: readOptionalMetric(record, 'total_replied', 'reply_count'),
    total_interested: readOptionalMetric(record, 'total_interested', 'total_opportunities'),
    total_bounced: readOptionalMetric(record, 'total_bounced', 'bounced_count'),
  }
}

function zeroCampaignAnalytics(): {
  total_sent: number
  total_opened: number
  total_replied: number
  total_interested: number
  total_bounced: number
} {
  return {
    total_sent: 0,
    total_opened: 0,
    total_replied: 0,
    total_interested: 0,
    total_bounced: 0,
  }
}

function hasAnyAnalyticsMetric(data: Record<string, unknown>): boolean {
  return [
    'total_sent',
    'emails_sent_count',
    'total_opened',
    'open_count',
    'total_replied',
    'reply_count',
    'total_interested',
    'total_opportunities',
    'total_bounced',
    'bounced_count',
  ].some((key) => key in data)
}

function readOptionalMetric(
  data: Record<string, unknown>,
  key: string,
  fallbackKey?: string,
): number {
  const value = data[key] ?? (fallbackKey ? data[fallbackKey] : undefined)
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Instantly getAnalytics returned an unexpected payload shape')
  }
  return value
}

export function createInstantlyAdapter(env: Env): InstantlyAdapter | null {
  if (!env.INSTANTLY_API_KEY) return null
  return new InstantlyAdapter(env.INSTANTLY_API_KEY, env)
}

async function readFailurePreview(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  const normalized = body.replace(/\s+/g, ' ').trim()
  if (normalized.length <= ERROR_BODY_PREVIEW_LIMIT) return normalized
  return `${normalized.slice(0, ERROR_BODY_PREVIEW_LIMIT - 3)}...`
}
