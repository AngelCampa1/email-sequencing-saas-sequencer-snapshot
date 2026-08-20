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

export default function CamauditNurtureBookDemoDirect({
  firstName,
  unsubscribeUrl,
}: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#2563eb"
      unsubscribeUrl={unsubscribeUrl}
      previewText="Book a demo before your CAM review window closes"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        Book a demo before your CAM review window closes
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Most leases give tenants a limited window to question CAM charges. If your reconciliation is
        already in hand, waiting can make recoverable issues harder to dispute.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        In a 20-minute CAMAudit demo, we can show how the system reviews exclusions, expense caps,
        pro-rata share, and suspicious year-over-year changes.
      </Text>
      <Button
        href="https://camaudit.io/demo"
        style={{ ...pillCtaStyle, backgroundColor: '#2563eb' }}
      >
        Book a demo
      </Button>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurtureBookDemoDirect {...props} />)
  const text = await render(<CamauditNurtureBookDemoDirect {...props} />, { plainText: true })
  return { html, text }
}
