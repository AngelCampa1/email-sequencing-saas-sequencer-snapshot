export const queryKeys = {
  overview: () => ['overview'] as const,
  products: () => ['products'] as const,
  sequences: (productSlug?: string) =>
    productSlug ? (['sequences', { product: productSlug }] as const) : (['sequences'] as const),
  contacts: (params?: Record<string, unknown>) =>
    params && Object.values(params).some((v) => v !== undefined)
      ? (['contacts', params] as const)
      : (['contacts'] as const),
  contactDetail: (id: string) => ['contact-detail', id] as const,
  contactDetailAll: () => ['contact-detail'] as const,
  suppressions: (params?: Record<string, unknown>) =>
    params && Object.values(params).some((v) => v !== undefined)
      ? (['suppressions', params] as const)
      : (['suppressions'] as const),
  templates: () => ['templates'] as const,
  templatePreview: (slug: string) => ['template-preview', slug] as const,
  leadMagnets: () => ['lead-magnets'] as const,
  deliverability: () => ['deliverability'] as const,
  audit: {
    all: () => ['audit'] as const,
    page: (p: number) => ['audit', p] as const,
    list: (params: Record<string, unknown>) => ['audit', params] as const,
  },
  apiTokens: () => ['api-tokens'] as const,
  me: () => ['me'] as const,
} as const
