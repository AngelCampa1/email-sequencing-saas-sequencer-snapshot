import { Link, Text } from '@react-email/components'
import { render } from '@react-email/render'
import React from 'react'
import { BaseLayout } from '../../layouts/base'

export interface TemplateProps {
  firstName?: string
  unsubscribeUrl: string
  productName?: string
}

export default function CamauditNurtureCaseStudy({ firstName, unsubscribeUrl }: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#2563eb"
      unsubscribeUrl={unsubscribeUrl}
      previewText="A quick CAMAudit case study"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        A quick CAMAudit case study
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        One tenant came to us after a reconciliation looked only slightly higher than expected. The
        total increase was not alarming, but the line items told a different story.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 8px' }}>
        <strong>Capital work mixed into repairs.</strong> A roof project was passed through as
        routine maintenance.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 8px' }}>
        <strong>Management fees above the lease cap.</strong> The statement used the landlord's
        standard percentage instead of the negotiated cap.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        <strong>Incorrect pro-rata share.</strong> A vacant expansion area was included in the
        denominator incorrectly.
      </Text>
      <Text
        style={{
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.6',
          margin: '0',
          borderTop: '1px solid #e5e7eb',
          paddingTop: '16px',
        }}
      >
        Want to see what CAMAudit would flag?{' '}
        <Link href="https://camaudit.io" style={{ color: '#2563eb' }}>
          Start with your latest statement
        </Link>
        .
      </Text>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurtureCaseStudy {...props} />)
  const text = await render(<CamauditNurtureCaseStudy {...props} />, { plainText: true })
  return { html, text }
}
