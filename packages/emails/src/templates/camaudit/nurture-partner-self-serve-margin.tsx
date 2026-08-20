import { Button, Text } from '@react-email/components'
import { render } from '@react-email/render'
import React from 'react'
import { pillCtaStyle } from '../../branding'
import { BaseLayout } from '../../layouts/base'

export interface TemplateProps {
  firstName?: string
  unsubscribeUrl: string
  productName?: string
}

export default function CamauditNurturePartnerSelfServeMargin({
  firstName,
  unsubscribeUrl,
}: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="Turn a lease you'd skip into paid work"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        Turn a small lease into paid work
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Every firm skips some CAM reviews. The lease is too small. The math takes too long by hand.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        CAMAudit runs the math for you. That turns a lease you'd normally skip into a billable
        engagement.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Audit packs work like credits. Buy a pack once. There's no subscription and no monthly fee.
        Unused credits stay in your account until you use them.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Each audit adds per-engagement margin. It doesn't add more hours for your team.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        See pack pricing in your workspace. Pick the size that fits your book of business.
      </Text>
      <Button
        href="https://partner.camaudit.io/onboarding?step=3"
        style={{ ...pillCtaStyle, backgroundColor: '#1e40af' }}
      >
        See pack pricing
      </Button>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurturePartnerSelfServeMargin {...props} />)
  const text = await render(<CamauditNurturePartnerSelfServeMargin {...props} />, {
    plainText: true,
  })
  return { html, text }
}
