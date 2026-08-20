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

export default function CamauditNurturePartnerSelfServeDemo({
  firstName,
  unsubscribeUrl,
}: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="Look at a full sample audit before you run your own"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        See a finished CAM audit
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Your workspace is ready. Before you run your first audit, look at a finished one.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        The sample audit shows real overcharges. Each one points to the lease clause that was
        broken. Each one shows the math behind the number.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        You also get a sample dispute letter. You get the branded report your client sees, too. You
        hand your client the findings, the math, and the next step.
      </Text>
      <Button
        href="https://partner.camaudit.io/audits/demo"
        style={{ ...pillCtaStyle, backgroundColor: '#1e40af' }}
      >
        See the sample audit
      </Button>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurturePartnerSelfServeDemo {...props} />)
  const text = await render(<CamauditNurturePartnerSelfServeDemo {...props} />, {
    plainText: true,
  })
  return { html, text }
}
