import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertValues = vi.fn()
const onConflictDoNothing = vi.fn()
const returning = vi.fn()
const selectLimit = vi.fn()
const trackMetric = vi.fn()
const preparedStatements: Array<{ sql: string; binds: unknown[] }> = []

const suppressions = {
  __name: 'suppressions',
  id: 'suppressions.id',
  email: 'suppressions.email',
  scope: 'suppressions.scope',
  product_id: 'suppressions.product_id',
}

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  or: (...conditions: unknown[]) => ({ op: 'or', conditions }),
  isNull: (column: unknown) => ({ op: 'isNull', column }),
}))

vi.mock('@sequencer/db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  })),
  suppressions,
}))

vi.mock('../lib/observability', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn() })),
  trackMetric,
}))

function env() {
  return {
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...binds: unknown[]) => ({
          run: vi.fn(async () => {
            preparedStatements.push({ sql, binds })
          }),
        })),
      })),
    },
    SUPPRESSIONS: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    },
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    },
  } as any
}

describe('addSuppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preparedStatements.length = 0
    insertValues.mockReturnValue({ onConflictDoNothing })
    onConflictDoNothing.mockReturnValue({ returning })
  })

  it('creates the D1 row, KV entry, and metric for a new suppression', async () => {
    returning.mockResolvedValueOnce([{ id: 'supp_1' }])
    const testEnv = env()
    const { addSuppression } = await import('../lib/suppression')

    await expect(
      addSuppression(testEnv, 'USER@Example.com ', 'product', 'prod_camaudit', 'manual', 'manual'),
    ).resolves.toEqual({ created: true, id: 'supp_1' })

    expect(insertValues).toHaveBeenCalledWith({
      email: 'user@example.com',
      scope: 'product',
      product_id: 'prod_camaudit',
      reason: 'manual',
      source: 'manual',
    })
    expect(testEnv.SUPPRESSIONS.put).toHaveBeenCalledWith(
      'supp:product:prod_camaudit:user@example.com',
      'manual',
      { expirationTtl: 3600 },
    )
    expect(trackMetric).toHaveBeenCalledWith(testEnv.ANALYTICS, {
      name: 'suppression.applied',
      dims: { scope: 'product', product: 'prod_camaudit' },
    })
    expect(preparedStatements).toContainEqual({
      sql: expect.stringContaining('UPDATE seq_contact_products'),
      binds: [
        'unsubscribed',
        'unsubscribed',
        expect.any(String),
        'product',
        'manual',
        expect.any(String),
        'prod_camaudit',
        'user@example.com',
      ],
    })
  })

  it('repairs KV and membership status but does not emit applied metrics for an existing suppression', async () => {
    returning.mockResolvedValueOnce([])
    selectLimit.mockResolvedValueOnce([{ id: 'supp_1', reason: 'first reason' }])
    const testEnv = env()
    const { addSuppression } = await import('../lib/suppression')

    await expect(
      addSuppression(testEnv, 'USER@Example.com ', 'global', null, 'new reason', 'manual'),
    ).resolves.toEqual({ created: false, id: 'supp_1' })

    expect(insertValues).toHaveBeenCalledWith({
      email: 'user@example.com',
      scope: 'global',
      product_id: null,
      reason: 'new reason',
      source: 'manual',
    })
    expect(testEnv.SUPPRESSIONS.put).toHaveBeenCalledWith(
      'supp:global:user@example.com',
      'first reason',
      { expirationTtl: 3600 },
    )
    expect(preparedStatements).toContainEqual({
      sql: expect.stringContaining('UPDATE seq_contact_products'),
      binds: [
        'unsubscribed',
        'unsubscribed',
        expect.any(String),
        'global',
        'first reason',
        expect.any(String),
        'user@example.com',
      ],
    })
    expect(trackMetric).not.toHaveBeenCalled()
  })

  it('marks global bounce suppressions as bounced across memberships', async () => {
    returning.mockResolvedValueOnce([{ id: 'supp_1' }])
    const testEnv = env()
    const { addSuppression } = await import('../lib/suppression')

    await expect(
      addSuppression(testEnv, 'USER@Example.com ', 'global', null, 'hard_bounce', 'bounce'),
    ).resolves.toEqual({ created: true, id: 'supp_1' })

    expect(preparedStatements).toContainEqual({
      sql: expect.stringContaining('UPDATE seq_contact_products'),
      binds: [
        'bounced',
        'bounced',
        expect.any(String),
        'global',
        'hard_bounce',
        expect.any(String),
        'user@example.com',
      ],
    })
  })

  it('rejects product-scoped suppressions without a product id', async () => {
    const testEnv = env()
    const { addSuppression } = await import('../lib/suppression')

    await expect(
      addSuppression(testEnv, 'USER@Example.com ', 'product', null, 'manual', 'manual'),
    ).rejects.toThrow('productId is required for product-scoped suppressions')

    expect(insertValues).not.toHaveBeenCalled()
    expect(testEnv.SUPPRESSIONS.put).not.toHaveBeenCalled()
    expect(trackMetric).not.toHaveBeenCalled()
  })
})
