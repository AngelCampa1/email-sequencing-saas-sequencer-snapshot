import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditLeadMagnetDialog, LeadMagnetsPage, NewLeadMagnetDialog } from './LeadMagnetsPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockUseQuery = vi.mocked(useQuery)
const mockUseMutation = vi.mocked(useMutation)
const mockUseQueryClient = vi.mocked(useQueryClient)

const leadMagnet = {
  id: 'lm_1',
  product_id: 'prod_1',
  product_slug: 'camaudit',
  product_name: 'CAMAudit',
  slug: 'tenant-checklist',
  name: 'Tenant checklist',
  asset_r2_bucket: 'camaudit-assets',
  asset_r2_key: 'tenant-checklist.pdf',
  asset_status: 'available',
  asset_size: 1200,
  fulfillment_sequence_slug: null,
  active: true,
  created_at: '2026-05-20T00:00:00.000Z',
}

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return {
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useQuery>
}

// Dialogs are rendered closed by default in static markup (Radix Dialog only renders
// portal content when open=true with a live DOM). We verify the a11y label bindings by
// inspecting the component source — this fails if the htmlFor binding is removed.
const pageSource = readFileSync(resolve(import.meta.dirname, 'LeadMagnetsPage.tsx'), 'utf-8')

describe('LeadMagnetsPage checkbox a11y', () => {
  it('edit dialog: checkbox id has a matching htmlFor label with visible text', () => {
    // id="lm-active-${lm.id}" must have a <label htmlFor matching it
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal source text contains a template placeholder
    expect(pageSource).toContain('id={`lm-active-${lm.id}`}')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal source text contains a template placeholder
    expect(pageSource).toContain('htmlFor={`lm-active-${lm.id}`}')
    // The label must contain the visible text "Active"
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal source text contains a template placeholder
    const htmlForIdx = pageSource.indexOf('htmlFor={`lm-active-${lm.id}`}')
    const surrounding = pageSource.slice(htmlForIdx, htmlForIdx + 200)
    expect(surrounding).toContain('Active')
  })

  it('new-lead-magnet dialog: checkbox id has a matching htmlFor label with visible text', () => {
    // id="new-lm-active" must have a <label htmlFor="new-lm-active"
    expect(pageSource).toContain('id="new-lm-active"')
    expect(pageSource).toContain('htmlFor="new-lm-active"')
    // The label must contain the visible text "Active"
    const htmlForIdx = pageSource.indexOf('htmlFor="new-lm-active"')
    const surrounding = pageSource.slice(htmlForIdx, htmlForIdx + 200)
    expect(surrounding).toContain('Active')
  })

  it('exports EditLeadMagnetDialog and NewLeadMagnetDialog for testability', () => {
    // Smoke-check: exports exist and are functions
    expect(typeof EditLeadMagnetDialog).toBe('function')
    expect(typeof NewLeadMagnetDialog).toBe('function')
  })
})

describe('LeadMagnetsPage copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue({ isPending: false, mutate: vi.fn(), error: null } as never)
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never)
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'lead-magnets') {
        return queryResult({ data: [leadMagnet] })
      }
      if (key === 'products') {
        return queryResult({
          data: [
            {
              id: 'prod_1',
              slug: 'camaudit',
              name: 'CAMAudit',
              created_at: '2026-05-20T00:00:00.000Z',
            },
          ],
        })
      }
      return queryResult({ data: undefined })
    })
  })

  it('does not imply every lead magnet enrolls contacts into a sequence', () => {
    const markup = renderToStaticMarkup(<LeadMagnetsPage />)

    expect(markup).toContain('Free downloads you give to collect emails')
    expect(markup).toContain('No follow-up email')
    expect(markup).not.toContain('Downloadable resources that enroll contacts into sequences')
  })

  it('keeps asset rows visible when only the product label query fails', () => {
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'lead-magnets') {
        return queryResult({ data: [leadMagnet] })
      }
      if (key === 'products') {
        return queryResult({ error: new Error('products unavailable') })
      }
      return queryResult({ data: undefined })
    })

    const markup = renderToStaticMarkup(<LeadMagnetsPage />)

    expect(markup).toContain('Tenant checklist')
    expect(markup).toContain('File ready')
    expect(markup).not.toContain('Failed to load product labels')
  })
})
