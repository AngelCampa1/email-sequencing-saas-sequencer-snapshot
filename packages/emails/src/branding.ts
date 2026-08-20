export const productBranding = {
  camaudit: {
    name: 'CAMAudit',
    color: '#1e40af',
    logoUrl: 'https://sequencer.ventoralabs.com/email-logos/camaudit.png?v=20260514-official',
  },
  'floriva-web': {
    name: 'Floriva',
    color: '#15803d',
    logoUrl: 'https://sequencer.ventoralabs.com/email-logos/floriva-web.png?v=20260514-official',
  },
} as const

export type ProductSlug = keyof typeof productBranding

export const pillCtaStyle = {
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '999px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
} as const
