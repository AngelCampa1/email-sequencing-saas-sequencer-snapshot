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

export default function CamauditNurturePartnerSelfServeCapacity({
  firstName,
  unsubscribeUrl,
}: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="Get audit capacity in place before reconciliation season"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        Get ready before reconciliation season
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        CAM reconciliations pile up every year. Most of the work lands between January and June.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Firms that plan ahead do better. Buy your audit credits now, before the busy season starts.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Each credit gives you one full audit. You add audit capacity for your team without hiring
        anyone new.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        When statements start landing on your desk, your credits are already there. You just run the
        audit.
      </Text>
      <Button
        href="https://partner.camaudit.io/onboarding?step=3"
        style={{ ...pillCtaStyle, backgroundColor: '#1e40af' }}
      >
        Get your audit credits
      </Button>
      <Text
        style={{
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.6',
          margin: '24px 0 0',
          borderTop: '1px solid #e5e7eb',
          paddingTop: '16px',
        }}
      >
        Have a question about how packs work? Reply to this email. We read every reply.
      </Text>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurturePartnerSelfServeCapacity {...props} />)
  const text = await render(<CamauditNurturePartnerSelfServeCapacity {...props} />, {
    plainText: true,
  })
  return { html, text }
}
