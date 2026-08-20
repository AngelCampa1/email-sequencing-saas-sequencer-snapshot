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

export default function CamauditFulfillmentChecklist({ firstName, unsubscribeUrl }: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="Your CAM pre-send checklist is here"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        Your CAM pre-send packet checklist is ready, {name}
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Thanks for downloading. Your checklist covers the pre-send review steps that catch CAM
        reconciliation errors before statements go out, from GL tie-outs to allocation and cap
        checks.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        Grab the checklist here:
      </Text>
      <Button
        href="https://camaudit.io/tools/cam-pre-send-packet-checklist-download"
        style={{ ...pillCtaStyle, backgroundColor: '#1e40af' }}
      >
        Download checklist
      </Button>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '24px 0 0' }}>
        CAMAudit helps property teams and operators catch Common Area Maintenance reconciliation
        issues before they create disputes. If you want a second set of eyes on your next packet,
        that's exactly what we're here for.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '16px 0 0' }}>
        Questions? Just reply to this email.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', margin: '24px 0 0' }}>
        - The CAMAudit team
      </Text>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditFulfillmentChecklist {...props} />)
  const text = await render(<CamauditFulfillmentChecklist {...props} />, { plainText: true })
  return { html, text }
}
