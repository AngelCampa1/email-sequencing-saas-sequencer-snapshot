import { describe, expect, it } from 'vitest'
import { ListMembershipRequestSchema, ProductSlugSchema } from './index'

const RETIRED_PRODUCTS = [
  'capveri',
  'gathergrove',
  'geoleap',
  'skillledger',
  'kaiplan',
  'lextract',
  'pebbledesk',
  'boardstack',
  'phiguard',
  'grantpipe',
] as const

describe('ListMembershipRequestSchema', () => {
  it('parses a minimal valid request', () => {
    const parsed = ListMembershipRequestSchema.parse({
      email: 'User@Example.com',
      list_slug: 'camaudit-all',
    })

    expect(parsed.email).toBe('user@example.com')
    expect(parsed.list_slug).toBe('camaudit-all')
  })

  it('parses a full valid request', () => {
    const parsed = ListMembershipRequestSchema.parse({
      email: '  Hello@Test.com  ',
      list_slug: 'camaudit-lead-magnet',
      list_name: 'CAMAudit Lead Magnet List',
      properties: { plan: 'trial' },
    })

    expect(parsed.email).toBe('hello@test.com')
    expect(parsed.list_slug).toBe('camaudit-lead-magnet')
    expect(parsed.list_name).toBe('CAMAudit Lead Magnet List')
    expect(parsed.properties).toEqual({ plan: 'trial' })
  })

  it('rejects a missing email', () => {
    expect(ListMembershipRequestSchema.safeParse({ list_slug: 'camaudit-all' }).success).toBe(false)
  })

  it('rejects an invalid email', () => {
    expect(
      ListMembershipRequestSchema.safeParse({ email: 'not-an-email', list_slug: 'camaudit-all' })
        .success,
    ).toBe(false)
  })

  it('rejects a blank list_slug', () => {
    expect(
      ListMembershipRequestSchema.safeParse({ email: 'user@example.com', list_slug: '   ' })
        .success,
    ).toBe(false)
  })

  it('rejects a missing list_slug', () => {
    expect(ListMembershipRequestSchema.safeParse({ email: 'user@example.com' }).success).toBe(false)
  })
})

describe('ProductSlugSchema', () => {
  it('accepts only products that remain live in Sequencer', () => {
    expect(ProductSlugSchema.options.sort()).toEqual(['camaudit', 'floriva-web'])
    for (const product of RETIRED_PRODUCTS) {
      expect(ProductSlugSchema.safeParse(product).success).toBe(false)
    }
  })
})
