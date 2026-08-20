import { describe, expect, it } from 'vitest'
import {
  EnrollmentRequestSchema,
  EventRequestSchema,
  ProductUnsubscribeRequestSchema,
  SequenceDefinitionSchema,
  UnsubscribeRequestSchema,
  UpsertContactSchema,
} from './index'

describe('product API email schemas', () => {
  it('normalizes contact upsert emails before validation output', () => {
    const parsed = UpsertContactSchema.parse({
      email: '  User@Example.com  ',
      product: 'camaudit',
    })

    expect(parsed.email).toBe('user@example.com')
  })

  it('normalizes enrollment emails before validation output', () => {
    const parsed = EnrollmentRequestSchema.parse({
      email: '  User@Example.com  ',
      sequence_slug: 'tenant-checklist',
    })

    expect(parsed.email).toBe('user@example.com')
  })

  it('rejects blank enrollment sequence slugs and sources', () => {
    for (const body of [
      { email: 'user@example.com', sequence_slug: '   ' },
      { email: 'user@example.com', sequence_slug: 'tenant-checklist', source: '   ' },
    ]) {
      expect(EnrollmentRequestSchema.safeParse(body).success).toBe(false)
    }
  })

  it('normalizes event emails before validation output', () => {
    const parsed = EventRequestSchema.parse({
      email: '  User@Example.com  ',
      product: 'camaudit',
      event: 'reply_received',
    })

    expect(parsed.email).toBe('user@example.com')
  })

  it('rejects blank event names', () => {
    const parsed = EventRequestSchema.safeParse({
      email: 'user@example.com',
      product: 'camaudit',
      event: '   ',
    })

    expect(parsed.success).toBe(false)
  })

  it('normalizes unsubscribe emails before validation output', () => {
    const parsed = UnsubscribeRequestSchema.parse({
      email: '  User@Example.com  ',
      product: 'camaudit',
    })

    expect(parsed.email).toBe('user@example.com')
  })

  it('models product API unsubscribe as product-scoped with an explicit product', () => {
    const parsed = ProductUnsubscribeRequestSchema.parse({
      email: '  User@Example.com  ',
      product: 'camaudit',
    })

    expect(parsed).toMatchObject({
      email: 'user@example.com',
      product: 'camaudit',
      scope: 'product',
    })
    expect(
      ProductUnsubscribeRequestSchema.safeParse({
        email: 'user@example.com',
        scope: 'product',
      }).success,
    ).toBe(false)
    expect(
      ProductUnsubscribeRequestSchema.safeParse({
        email: 'user@example.com',
        product: 'camaudit',
        scope: 'global',
      }).success,
    ).toBe(false)
  })
})

describe('sequence definition schema', () => {
  const validSequence = {
    slug: 'valid-sequence',
    product: 'camaudit',
    version: 1,
    steps: [
      {
        id: 'step-1',
        delay: '0m',
        template: 'welcome',
        subject: 'Welcome',
      },
    ],
  }

  it('rejects sequences without at least one step', () => {
    const parsed = SequenceDefinitionSchema.safeParse({
      slug: 'empty-steps',
      product: 'camaudit',
      version: 1,
      steps: [],
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.errors.some((e) => /at least one step/i.test(e.message))).toBe(true)
    }
  })

  it('rejects blank runtime-critical sequence fields', () => {
    const invalidDefinitions = [
      { ...validSequence, slug: '   ' },
      { ...validSequence, steps: [{ ...validSequence.steps[0], id: '   ' }] },
      { ...validSequence, steps: [{ ...validSequence.steps[0], template: '   ' }] },
      { ...validSequence, steps: [{ ...validSequence.steps[0], subject: '   ' }] },
      { ...validSequence, steps: [{ ...validSequence.steps[0], subject: { a: '   ' } }] },
      { ...validSequence, variants: [{ id: '   ', weight: 100 }] },
      { ...validSequence, exit_conditions: [{ event: '   ' }] },
      { ...validSequence, enroll: { trigger: '   ' } },
      { ...validSequence, enroll: { trigger: 'lead_magnet', lead_magnet: '   ' } },
    ]

    for (const definition of invalidDefinitions) {
      expect(SequenceDefinitionSchema.safeParse(definition).success).toBe(false)
    }
  })
})
