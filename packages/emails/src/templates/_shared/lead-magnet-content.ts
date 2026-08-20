import type { ProductSlug } from '../../branding'

export interface LeadMagnetContent {
  name: string
  landingUrl: string
  oneLineValue: string
  subject: string
  preview: string
  headline: string
  body: readonly string[]
  ctaLabel: string
}

export const leadMagnetContent: Partial<Record<ProductSlug, LeadMagnetContent>> = {
  'floriva-web': {
    name: 'Period App Privacy Audit Checklist',
    landingUrl: 'https://floriva.app/free/period-app-privacy-audit-checklist',
    oneLineValue:
      'It shows you what any period app really does with your data. Not just what the ads claim.',
    subject: 'Your period app privacy checklist',
    preview: 'See what your old app really tracks',
    headline: 'Your privacy checklist is ready',
    body: [
      'You just started with Floriva. First, do a quick check of any app you used before. Most period apps collect far more than they need.',
      'This checklist shows you how. Where your data is stored. What permissions the app really needs. How to see what it sends over the network while you log a symptom.',
      'Run it on your old tracker. You will likely be surprised by what was leaving your phone. Then you can delete it for good.',
    ],
    ctaLabel: 'Get the checklist',
  },
}

export function getLeadMagnetContent(product: string): LeadMagnetContent | undefined {
  return leadMagnetContent[product as ProductSlug]
}
