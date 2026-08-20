import { describe, expect, it } from 'vitest'
import { buildEmailTemplateProps } from '../lib/email-branding'

describe('email template branding', () => {
  it('uses product display name and brand color instead of slug fallback', async () => {
    const props = await buildEmailTemplateProps({
      contactEmail: 'person@example.com',
      productSlug: 'floriva-web',
      productName: 'Floriva',
      brandColor: '#15803d',
      subject: 'Welcome',
      sequenceSlug: 'floriva-web-onboarding',
      unsubscribeSigningSecret: 'test-unsubscribe-signing-secret',
    })

    expect(props).toMatchObject({
      firstName: undefined,
      productName: 'Floriva',
      brandColor: '#15803d',
      subject: 'Welcome',
      sequenceSlug: 'floriva-web-onboarding',
    })
    const unsubscribeUrl = new URL(props.unsubscribeUrl)
    expect(unsubscribeUrl.origin).toBe('https://sequencer.ventoralabs.com')
    expect(unsubscribeUrl.pathname).toBe('/unsubscribe')
    expect(unsubscribeUrl.searchParams.get('email')).toBe('person@example.com')
    expect(unsubscribeUrl.searchParams.get('product')).toBe('floriva-web')
    expect(unsubscribeUrl.searchParams.get('sig')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('generates unsubscribe links outside the Access-protected product API route', async () => {
    const props = await buildEmailTemplateProps({
      contactEmail: 'person@example.com',
      productSlug: 'camaudit',
      productName: 'CAMAudit',
      brandColor: '#2563eb',
      subject: 'Welcome',
      sequenceSlug: 'camaudit-onboarding',
      unsubscribeSigningSecret: 'test-unsubscribe-signing-secret',
    })

    expect(new URL(props.unsubscribeUrl).pathname).toBe('/unsubscribe')
  })
})
