import { describe, expect, it } from 'vitest'

describe('API route exports', () => {
  it('contacts route exports', async () => {
    const { contactsRoute } = await import('../routes/api/v1/contacts')
    expect(contactsRoute).toBeDefined()
  })
  it('events route exports', async () => {
    const { eventsRoute } = await import('../routes/api/v1/events')
    expect(eventsRoute).toBeDefined()
  })
  it('unsubscribe route exports', async () => {
    const { unsubscribeRoute } = await import('../routes/api/v1/unsubscribe')
    expect(unsubscribeRoute).toBeDefined()
  })
  it('lead magnets route exports', async () => {
    const { leadMagnetsRoute } = await import('../routes/api/v1/lead-magnets')
    expect(leadMagnetsRoute).toBeDefined()
  })
})

describe('Cron handler', () => {
  it('exports handleCron function', async () => {
    const { handleCron } = await import('../crons/index')
    expect(typeof handleCron).toBe('function')
  })
})
