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

export default function CamauditNurturePartnerSelfServeDisputeLetter({
  firstName,
  unsubscribeUrl,
}: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="The audit finds the overcharges. The letter is how your client disputes them."
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        The dispute letter is half the job
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        An audit finds the overcharges. That's half the job.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        The other half is the letter your client sends to claw it back. CAMAudit builds a dispute
        letter draft from the findings. It lands in your workspace, ready for your review.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        You read it first. You sign it. It goes out under your firm's name, not ours.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        Every line in the letter points to a lease clause. It also points to the exact line on the
        statement. Your client can see why each charge is wrong.
      </Text>
      <Button
        href="https://partner.camaudit.io/audits/demo"
        style={{ ...pillCtaStyle, backgroundColor: '#1e40af' }}
      >
        See a sample dispute letter
      </Button>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurturePartnerSelfServeDisputeLetter {...props} />)
  const text = await render(<CamauditNurturePartnerSelfServeDisputeLetter {...props} />, {
    plainText: true,
  })
  return { html, text }
}
