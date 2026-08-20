export const liveProductConfigs = {
  'floriva-web': {
    productName: 'Floriva',
    brandColor: '#15803d',
    dashboardUrl: 'https://floriva.app',
    welcomeHeadline: 'Welcome to Floriva',
    welcomeBody: [
      'Floriva is ready for the first planning pass. Start by reviewing the site experience and the trust signals your visitors will see first.',
      'Sequencer will keep this onboarding light: one direct welcome, then one value email with the next best action.',
    ],
    welcomeCta: 'Open Floriva',
    nurturePreview: 'A quick Floriva setup pass',
    nurtureHeadline: 'Make the first visit easier to trust',
    nurtureBody: [
      'The fastest improvement is to confirm that your primary call to action, proof points, and support route are visible before someone has to hunt for them.',
      'When those pieces are clear, Floriva can carry more of the product story without extra sales explanation.',
    ],
  },
} as const

export type LiveProductSlug = keyof typeof liveProductConfigs
