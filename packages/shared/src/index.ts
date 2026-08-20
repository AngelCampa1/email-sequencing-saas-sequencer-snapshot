import { z } from 'zod'

// Product
export const ProductSlugSchema = z.enum(['camaudit', 'floriva-web'])
export type ProductSlug = z.infer<typeof ProductSlugSchema>

export const PRODUCT_FIREWALL: Partial<Record<ProductSlug, ProductSlug>> = {}

// Sequence DSL
const NonEmptySequenceStringSchema = z.string().trim().min(1, 'Required')
export const StepDelaySchema = z.string().regex(/^\d+(m|h|d)$/, 'Delay must be like 0m, 2h, 5d')

export const SequenceStepSchema = z.object({
  id: NonEmptySequenceStringSchema,
  delay: StepDelaySchema,
  template: NonEmptySequenceStringSchema,
  subject: z.union([NonEmptySequenceStringSchema, z.record(NonEmptySequenceStringSchema)]),
  skip_if: z.record(z.unknown()).optional(),
})

export const SequenceVariantSchema = z.object({
  id: NonEmptySequenceStringSchema,
  weight: z.number().min(0).max(100),
})

export const SequenceDefinitionSchema = z.object({
  slug: NonEmptySequenceStringSchema,
  product: ProductSlugSchema,
  version: z.number().int().positive(),
  goal: z.string().optional(),
  exit_conditions: z.array(z.object({ event: NonEmptySequenceStringSchema })).default([]),
  enroll: z
    .object({
      trigger: NonEmptySequenceStringSchema,
      lead_magnet: NonEmptySequenceStringSchema.optional(),
    })
    .optional(),
  variants: z.array(SequenceVariantSchema).optional(),
  steps: z.array(SequenceStepSchema).min(1, 'Sequence must define at least one step'),
})
export type SequenceDefinition = z.infer<typeof SequenceDefinitionSchema>

// API request/response shapes
export const EmailSchema = z.string().trim().toLowerCase().email()

export const UpsertContactSchema = z.object({
  email: EmailSchema,
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  product: ProductSlugSchema,
})
export type UpsertContactRequest = z.infer<typeof UpsertContactSchema>

export const EnrollmentRequestSchema = z.object({
  email: EmailSchema,
  sequence_slug: NonEmptySequenceStringSchema,
  properties: z.record(z.unknown()).optional(),
  source: NonEmptySequenceStringSchema.default('api'),
})
export type EnrollmentRequest = z.input<typeof EnrollmentRequestSchema>

export const EventRequestSchema = z.object({
  email: EmailSchema,
  event: z.string().trim().min(1),
  product: ProductSlugSchema,
  properties: z.record(z.unknown()).optional(),
})
export type EventRequest = z.infer<typeof EventRequestSchema>

export const UnsubscribeRequestSchema = z.object({
  email: EmailSchema,
  product: ProductSlugSchema.optional(),
  scope: z.enum(['product', 'global']).default('product'),
  reason: z.string().optional(),
})
export type UnsubscribeRequest = z.input<typeof UnsubscribeRequestSchema>

export const ProductUnsubscribeRequestSchema = z.object({
  email: EmailSchema,
  product: ProductSlugSchema,
  scope: z.literal('product').default('product'),
  reason: z.string().optional(),
})
export type ProductUnsubscribeRequest = z.input<typeof ProductUnsubscribeRequestSchema>

export const ListMembershipRequestSchema = z.object({
  email: EmailSchema,
  list_slug: z.string().trim().min(1, 'list_slug is required'),
  list_name: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
})
export type ListMembershipRequest = z.input<typeof ListMembershipRequestSchema>
