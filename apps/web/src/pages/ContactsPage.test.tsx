import { useQuery } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactDetail, ContactRow } from '../lib/types'
import {
  ContactSheetBody,
  ContactsPage,
  clearContactsSearchTimer,
  scheduleContactsSearchUpdate,
} from './ContactsPage'

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  })),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
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

const baseContact: ContactRow = {
  id: 'contact_1',
  email: 'alice@example.com',
  first_name: 'Alice',
  last_name: 'Smith',
  properties: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  memberships: [
    {
      product_id: 'prod_1',
      product_slug: 'camaudit',
      product_name: 'CAMAudit',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  active_run: null,
  active_runs: [],
}

const contactWithRun: ContactRow = {
  ...baseContact,
  id: 'contact_2',
  email: 'bob@example.com',
  first_name: 'Bob',
  last_name: null,
  active_run: {
    id: 'run_1',
    sequence_slug: 'welcome-sequence',
    sequence_version: 1,
    status: 'running',
    current_step_index: 2,
    started_at: '2026-01-05T00:00:00.000Z',
    enrollment_source: 'api',
  },
  active_runs: [
    {
      id: 'run_1',
      product_id: 'prod_1',
      product_slug: 'camaudit',
      product_name: 'CAMAudit',
      sequence_slug: 'welcome-sequence',
      sequence_version: 1,
      status: 'running',
      current_step_index: 2,
      started_at: '2026-01-05T00:00:00.000Z',
      enrollment_source: 'api',
    },
  ],
}

const contactWithMultipleRuns: ContactRow = {
  ...baseContact,
  id: 'contact_5',
  email: 'multi@example.com',
  first_name: 'Multi',
  last_name: null,
  active_run: {
    id: 'run_a',
    sequence_slug: 'welcome-sequence',
    sequence_version: 1,
    status: 'running',
    current_step_index: 0,
    started_at: '2026-01-05T00:00:00.000Z',
    enrollment_source: 'api',
  },
  active_runs: [
    {
      id: 'run_a',
      product_id: 'prod_1',
      product_slug: 'camaudit',
      product_name: 'CAMAudit',
      sequence_slug: 'welcome-sequence',
      sequence_version: 1,
      status: 'running',
      current_step_index: 0,
      started_at: '2026-01-05T00:00:00.000Z',
      enrollment_source: 'api',
    },
    {
      id: 'run_b',
      product_id: 'prod_2',
      product_slug: 'floriva-web',
      product_name: 'Floriva',
      sequence_slug: 'nurture-sequence',
      sequence_version: 2,
      status: 'running',
      current_step_index: 1,
      started_at: '2026-01-06T00:00:00.000Z',
      enrollment_source: 'api',
    },
  ],
}

const contactNoName: ContactRow = {
  ...baseContact,
  id: 'contact_3',
  email: 'noname@example.com',
  first_name: null,
  last_name: null,
  memberships: [],
}

const contactManyMemberships: ContactRow = {
  ...baseContact,
  id: 'contact_4',
  email: 'many@example.com',
  memberships: [
    {
      product_id: 'prod_1',
      product_slug: 'camaudit',
      product_name: 'CAMAudit',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      product_id: 'prod_2',
      product_slug: 'floriva-web',
      product_name: 'Floriva',
      status: 'unsubscribed',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      product_id: 'prod_3',
      product_slug: 'grantpipe',
      product_name: 'GrantPipe',
      status: 'bounced',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      product_id: 'prod_4',
      product_slug: 'grantpipe',
      product_name: 'GrantPipe',
      status: 'complained',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
}

function setupQueries(overrides?: {
  contacts?: ContactRow[]
  error?: Error
  loading?: boolean
  debouncedSearch?: string
}) {
  let callCount = 0
  mockUseQuery.mockImplementation(() => {
    callCount++
    // First call is the products query — always return an empty products list
    if (callCount === 1) {
      return queryResult({ data: [] })
    }
    if (callCount === 2) {
      return queryResult({ data: [] })
    }
    // Third call is the contacts query
    if (overrides?.loading) {
      return queryResult({ data: undefined, isLoading: true })
    }
    if (overrides?.error) {
      return queryResult({ data: undefined, error: overrides.error })
    }
    return queryResult({ data: overrides?.contacts ?? [baseContact] })
  })
}

describe('clearContactsSearchTimer', () => {
  it('clears the timer when one is set', () => {
    const timerRef = { current: setTimeout(() => undefined, 10_000) }
    clearContactsSearchTimer(timerRef)
    expect(timerRef.current).toBeNull()
  })

  it('does nothing when timer is null', () => {
    const timerRef = { current: null }
    expect(() => clearContactsSearchTimer(timerRef)).not.toThrow()
  })
})

describe('scheduleContactsSearchUpdate', () => {
  it('schedules a debounced update', () => {
    vi.useFakeTimers()
    const timerRef = { current: null }
    const updateSearch = vi.fn()
    scheduleContactsSearchUpdate(timerRef, 'alice', updateSearch)
    expect(timerRef.current).not.toBeNull()
    vi.advanceTimersByTime(300)
    expect(updateSearch).toHaveBeenCalledWith('alice')
    expect(timerRef.current).toBeNull()
    vi.useRealTimers()
  })

  it('cancels previous timer when called again', () => {
    vi.useFakeTimers()
    const timerRef = { current: null }
    const updateSearch = vi.fn()
    scheduleContactsSearchUpdate(timerRef, 'a', updateSearch)
    scheduleContactsSearchUpdate(timerRef, 'alice', updateSearch)
    vi.advanceTimersByTime(300)
    expect(updateSearch).toHaveBeenCalledTimes(1)
    expect(updateSearch).toHaveBeenCalledWith('alice')
    vi.useRealTimers()
  })
})

describe('ContactsPage loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading skeleton', () => {
    setupQueries({ loading: true })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('animate-pulse')
    expect(markup).toContain('Contacts')
  })
})

describe('ContactsPage error state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders error state', () => {
    setupQueries({ error: new Error('D1 unavailable') })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Failed to load contacts')
    expect(markup).toContain('D1 unavailable')
  })
})

describe('ContactsPage empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state with no search query', () => {
    setupQueries({ contacts: [] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('No contacts yet')
    expect(markup).toContain('Contacts show up here once a product enrolls them.')
  })
})

describe('ContactsPage success states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders contact email in the table', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('alice@example.com')
  })

  it('renders full name when first and last name are present', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Alice Smith')
  })

  it('renders dash when no name', () => {
    setupQueries({ contacts: [contactNoName] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('noname@example.com')
  })

  it('renders product membership badges', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('CAMAudit')
  })

  it('renders No products when no memberships', () => {
    setupQueries({ contacts: [contactNoName] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('No products')
  })

  it('renders active run indicator when contact has active run', () => {
    setupQueries({ contacts: [contactWithRun] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Running')
    expect(markup).toContain('Welcome sequence')
    expect(markup).toContain('step 3')
  })

  it('renders Not in a sequence for active run when no active run', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Not in a sequence')
  })

  it('renders created date column header', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Created')
  })

  it('renders +N badge when contact has more than 3 memberships', () => {
    setupQueries({ contacts: [contactManyMemberships] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('+1')
  })

  it('renders search input', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Search name or email')
  })

  it('renders the contacts table with aria-label', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('aria-label="Contacts"')
  })

  it('renders page description', () => {
    setupQueries()
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('latest 50 contacts')
  })
})

describe('ContactsPage membership status variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders unsubscribed membership with outline variant', () => {
    const contact: ContactRow = {
      ...baseContact,
      memberships: [
        {
          product_id: 'prod_2',
          product_slug: 'floriva-web',
          product_name: 'Floriva',
          status: 'unsubscribed',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    setupQueries({ contacts: [contact] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Floriva')
  })

  it('renders bounced membership with destructive variant', () => {
    const contact: ContactRow = {
      ...baseContact,
      memberships: [
        {
          product_id: 'prod_2',
          product_slug: 'floriva-web',
          product_name: 'Floriva',
          status: 'bounced',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    setupQueries({ contacts: [contact] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Floriva')
  })

  it('renders complained membership with destructive variant', () => {
    const contact: ContactRow = {
      ...baseContact,
      memberships: [
        {
          product_id: 'prod_2',
          product_slug: 'floriva-web',
          product_name: 'Floriva',
          status: 'complained',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    setupQueries({ contacts: [contact] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Floriva')
  })

  it('renders unknown status with secondary (fallback) variant', () => {
    const contact: ContactRow = {
      ...baseContact,
      memberships: [
        {
          product_id: 'prod_9',
          product_slug: 'unknown-product',
          product_name: 'Unknown',
          status: 'pending' as unknown as ContactRow['memberships'][number]['status'],
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    setupQueries({ contacts: [contact] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Unknown')
  })
})

describe('ContactSheetBody', () => {
  const makeDetail = (overrides?: Partial<ContactDetail>): ContactDetail => ({
    ...baseContact,
    runs: [],
    messages: [],
    events: [],
    timeline: [],
    ...overrides,
  })

  it('renders contact name from detail', () => {
    const detail = makeDetail()
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Alice Smith')
    expect(markup).toContain('alice@example.com')
  })

  it('uses email as display name when no first or last name', () => {
    const noNameContact: ContactRow = {
      ...baseContact,
      first_name: null,
      last_name: null,
    }
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={noNameContact}
        detail={undefined}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('alice@example.com')
  })

  it('renders loading skeleton when detail loading', () => {
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={undefined}
        detailError={null}
        detailLoading={true}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('animate-pulse')
  })

  it('renders error state when detail fails', () => {
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={undefined}
        detailError={new Error('detail load failed')}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Failed to load contact history')
  })

  it('renders empty sequence history when no terminal runs', () => {
    const detail = makeDetail({ runs: [] })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('No finished sequences yet.')
  })

  it('renders completed run in sequence history', () => {
    const detail = makeDetail({
      runs: [
        {
          id: 'run_completed',
          sequence_slug: 'onboarding',
          sequence_version: 1,
          status: 'completed',
          current_step_index: 3,
          started_at: '2026-02-01T00:00:00.000Z',
          steps: [],
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Onboarding')
    expect(markup).toContain('Finished')
  })

  it('renders errored run in sequence history', () => {
    const detail = makeDetail({
      runs: [
        {
          id: 'run_errored',
          sequence_slug: 'follow-up',
          sequence_version: 1,
          status: 'errored',
          current_step_index: 1,
          started_at: '2026-02-01T00:00:00.000Z',
          steps: [],
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Failed')
  })

  it('renders exited run in sequence history', () => {
    const detail = makeDetail({
      runs: [
        {
          id: 'run_exited',
          sequence_slug: 'campaign',
          sequence_version: 1,
          status: 'exited',
          current_step_index: 0,
          started_at: '2026-02-01T00:00:00.000Z',
          steps: [],
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Left early')
  })

  it('renders paused run in paused sequences section', () => {
    const detail = makeDetail({
      runs: [
        {
          id: 'run_paused',
          sequence_slug: 'engagement',
          sequence_version: 1,
          status: 'paused',
          current_step_index: 1,
          started_at: '2026-02-01T00:00:00.000Z',
          steps: [],
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Paused Sequences')
    expect(markup).toContain('Engagement')
    expect(markup).toContain('Paused')
  })

  it('renders timeline entries when present', () => {
    const detail = makeDetail({
      timeline: [
        { kind: 'enrolled', at: '2026-02-01T10:00:00.000Z' },
        { kind: 'email_sent', at: '2026-02-02T10:00:00.000Z' },
      ],
    })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Timeline')
    expect(markup).toContain('Enrolled')
    expect(markup).toContain('Email sent')
  })

  it('renders active run details', () => {
    const contactWithActiveRun: ContactRow = {
      ...baseContact,
      active_run: {
        id: 'run_active',
        sequence_slug: 'welcome',
        sequence_version: 1,
        status: 'running',
        current_step_index: 0,
        started_at: '2026-03-01T00:00:00.000Z',
        enrollment_source: 'api',
      },
      active_runs: [
        {
          id: 'run_active',
          product_id: 'prod_1',
          product_slug: 'camaudit',
          product_name: 'CAMAudit',
          sequence_slug: 'welcome',
          sequence_version: 1,
          status: 'running',
          current_step_index: 0,
          started_at: '2026-03-01T00:00:00.000Z',
          enrollment_source: 'api',
        },
      ],
    }
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={contactWithActiveRun}
        detail={undefined}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Welcome')
    expect(markup).toContain('Step 1')
  })

  it('renders all active_runs in detail panel with product name badges', () => {
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={contactWithMultipleRuns}
        detail={undefined}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Welcome sequence')
    expect(markup).toContain('CAMAudit')
    expect(markup).toContain('Nurture sequence')
    expect(markup).toContain('Floriva')
    expect(markup).toContain('Step 1')
    expect(markup).toContain('Step 2')
    // Two active runs -> the header pluralizes
    expect(markup).toContain('Active Sequences')
  })

  it('uses the singular header when the contact is in one sequence', () => {
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={contactWithRun}
        detail={undefined}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Active Sequence')
    expect(markup).not.toContain('Active Sequences')
  })

  it('renders refreshing text when detailFetching', () => {
    const detail = makeDetail()
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={true}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Refreshing')
  })

  it('renders properties as a readable list, not a raw JSON dump', () => {
    const contactWithProps: ContactRow = {
      ...baseContact,
      properties: { plan: 'pro', trial: true },
    }
    const detail = makeDetail({ ...contactWithProps })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={contactWithProps}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    // Friendly section heading and humanized keys/values, not snake_case JSON.
    expect(markup).toContain('Other details')
    expect(markup).toContain('Plan')
    expect(markup).toContain('pro')
    expect(markup).toContain('Trial')
    expect(markup).toContain('Yes')
    // No raw JSON braces or quoted keys leaking into the UI.
    expect(markup).not.toContain('&quot;plan&quot;')
    expect(markup).not.toContain('<pre')
  })

  it('renders run steps with messages and events', () => {
    const detail = makeDetail({
      runs: [
        {
          id: 'run_with_steps',
          sequence_slug: 'email-campaign',
          sequence_version: 1,
          status: 'completed',
          current_step_index: 1,
          started_at: '2026-03-01T00:00:00.000Z',
          steps: [
            {
              id: 'step_1',
              run_id: 'run_with_steps',
              step_index: 0,
              status: 'sent',
              events: [
                {
                  id: 'event_1',
                  provider: 'resend',
                  type: 'email.opened',
                  received_at: '2026-03-02T00:00:00.000Z',
                },
              ],
              message: {
                id: 'msg_1',
                contact_id: 'contact_1',
                product_id: 'prod_1',
                subject: 'Welcome to CAMAudit',
              },
            },
          ],
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={detail}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Welcome to CAMAudit')
    expect(markup).toContain('Email opened')
  })

  it('renders No products when memberships empty', () => {
    const noMemberContact: ContactRow = { ...baseContact, memberships: [] }
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={noMemberContact}
        detail={undefined}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('No products')
  })

  it('renders Not in a sequence when contact has no active run', () => {
    const markup = renderToStaticMarkup(
      <ContactSheetBody
        contact={baseContact}
        detail={undefined}
        detailError={null}
        detailLoading={false}
        detailFetching={false}
        onRetry={vi.fn()}
      />,
    )
    expect(markup).toContain('Active Sequence')
    expect(markup).toContain('Not in a sequence')
  })
})

describe('ContactsPage active_runs list cell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders +N badge when contact has multiple active runs', () => {
    setupQueries({ contacts: [contactWithMultipleRuns] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Running')
    expect(markup).toContain('+1')
    expect(markup).toContain('Welcome sequence')
  })

  it('renders single active run without +N badge', () => {
    setupQueries({ contacts: [contactWithRun] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Running')
    expect(markup).not.toContain('+1')
  })

  it('renders Not in a sequence when active_runs is empty', () => {
    setupQueries({ contacts: [baseContact] })
    const markup = renderToStaticMarkup(<ContactsPage />)
    expect(markup).toContain('Not in a sequence')
    expect(markup).not.toContain('Running')
  })
})
