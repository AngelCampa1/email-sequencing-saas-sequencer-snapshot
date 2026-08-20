import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactDetail, ContactRow } from '../lib/types'
import { ContactSheetBody } from './ContactsPage'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

const mockUseQuery = vi.mocked(useQuery)

function queryResult(value: Partial<ReturnType<typeof useQuery>>) {
  return {
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useQuery>
}

const contact: ContactRow = {
  id: 'contact_1',
  email: 'history@example.com',
  first_name: 'Hannah',
  last_name: 'History',
  properties: { plan: 'team' },
  created_at: '2026-05-18T10:00:00.000Z',
  updated_at: '2026-05-18T10:00:00.000Z',
  memberships: [
    {
      product_id: 'prod_camaudit',
      product_slug: 'camaudit',
      product_name: 'CAMAudit',
      status: 'active',
      created_at: '2026-05-18T10:01:00.000Z',
      updated_at: '2026-05-18T10:01:00.000Z',
    },
  ],
  active_run: null,
  active_runs: [],
}

const contactDetail: ContactDetail = {
  ...contact,
  runs: [
    {
      id: 'run_done',
      sequence_slug: 'camaudit-welcome',
      sequence_version: 1,
      status: 'exited',
      current_step_index: 1,
      enrollment_source: 'api',
      started_at: '2026-05-18T10:02:00.000Z',
      completed_at: '2026-05-18T10:30:00.000Z',
      steps: [
        {
          id: 'step_done',
          run_id: 'run_done',
          step_index: 0,
          template_slug: 'welcome',
          status: 'sent',
          scheduled_for: '2026-05-18T10:05:00.000Z',
          sent_at: '2026-05-18T10:06:00.000Z',
          message_id: 'msg_provider',
          message: {
            id: 'message_done',
            step_id: 'step_done',
            contact_id: 'contact_1',
            product_id: 'prod_camaudit',
            resend_message_id: 'msg_provider',
            subject: 'Welcome aboard',
            from_email: 'founder@camaudit.io',
            sent_at: '2026-05-18T10:06:00.000Z',
          },
          events: [
            {
              id: 'event_opened',
              provider: 'resend',
              message_id: 'msg_provider',
              type: 'email.opened',
              payload: { email_id: 'msg_provider' },
              received_at: '2026-05-18T10:08:00.000Z',
            },
          ],
        },
      ],
    },
  ],
  messages: [],
  events: [],
  timeline: [
    { kind: 'run.started', at: '2026-05-18T10:02:00.000Z', run_id: 'run_done', status: 'exited' },
    { kind: 'message.sent', at: '2026-05-18T10:06:00.000Z', message_id: 'msg_provider' },
    {
      kind: 'event.email.opened',
      at: '2026-05-18T10:08:00.000Z',
      event_id: 'event_opened',
      type: 'email.opened',
    },
    {
      kind: 'run.completed',
      at: '2026-05-18T10:30:00.000Z',
      run_id: 'run_done',
      status: 'completed',
    },
  ],
}

describe('ContactsPage contact detail history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((options) => {
      const key = (options as { queryKey: string[] }).queryKey[0]
      if (key === 'contacts') return queryResult({ data: [contact] })
      if (key === 'contact-detail') return queryResult({ data: contactDetail })
      return queryResult({ data: undefined })
    })
  })

  it('renders completed runs, messages, and events in the contact sheet', () => {
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={contact}
        detail={contactDetail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={() => undefined}
      />,
    )

    expect(markup).toContain('Sequence History')
    expect(markup).toContain('Welcome')
    expect(markup).toContain('Left early')
    expect(markup).toContain('Welcome aboard')
    expect(markup).toContain('Email opened')
    expect(markup).toContain('Run completed')
  })

  it('uses fresh detail data instead of stale list data in the sheet', () => {
    const staleContact: ContactRow = {
      ...contact,
      active_run: {
        id: 'run_stale',
        sequence_slug: 'stale-running',
        sequence_version: 1,
        status: 'running',
        current_step_index: 0,
        started_at: '2026-05-18T09:00:00.000Z',
        enrollment_source: 'api',
      },
    }
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={staleContact}
        detail={contactDetail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={() => undefined}
      />,
    )

    expect(markup).toContain('Active Sequence')
    expect(markup).toContain('Not in a sequence')
    expect(markup).not.toContain('stale-running')
  })

  it('keeps paused runs out of terminal sequence history', () => {
    const detailWithPausedRun: ContactDetail = {
      ...contactDetail,
      runs: [
        {
          id: 'run_paused',
          sequence_slug: 'paused-welcome',
          sequence_version: 1,
          status: 'paused',
          current_step_index: 2,
          enrollment_source: 'api',
          started_at: '2026-05-18T10:02:00.000Z',
          completed_at: null,
          steps: [],
        },
      ],
      timeline: [],
    }

    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={contact}
        detail={detailWithPausedRun}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={() => undefined}
      />,
    )

    expect(markup).toContain('Sequence History')
    expect(markup).toContain('Paused Sequences')
    expect(markup).toContain('Paused welcome')
    expect(markup).toContain(
      'Sequence History</p></div><p class="text-sm text-slate-500">No finished sequences yet.</p>',
    )
  })
})
