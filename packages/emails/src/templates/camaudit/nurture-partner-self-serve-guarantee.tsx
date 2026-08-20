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

export default function CamauditNurturePartnerSelfServeGuarantee({
  firstName,
  unsubscribeUrl,
}: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="Every pack has a 30-day money-back guarantee"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        Every pack has a 30-day guarantee
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Some firms wait to buy a pack. They want to see it work first.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Every CAMAudit pack comes with a 30-day money-back guarantee. If it's not a fit, you get
        your money back.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Unused credits don't expire when you buy. They stay in your account and wait for the next
        lease.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        You stay the auditor. CAMAudit does the math and finds the issues. You review each finding
        before it goes to a client.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        Every finding points to the lease clause and the statement line behind it. You can check the
        work in minutes, not hours.
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
  const html = await render(<CamauditNurturePartnerSelfServeGuarantee {...props} />)
  const text = await render(<CamauditNurturePartnerSelfServeGuarantee {...props} />, {
    plainText: true,
  })
  return { html, text }
}
