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

export default function CamauditNurtureBookDemoSoft({ firstName, unsubscribeUrl }: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#2563eb"
      unsubscribeUrl={unsubscribeUrl}
      previewText="A low-pressure CAMAudit demo"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        Want a quick demo with your own CAM statement?
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        If the checklist was useful, bring one reconciliation statement and we will walk through
        what CAMAudit checks.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        The demo is a practical review of exclusions, caps, pro-rata share, and line items that
        often deserve a second look.
      </Text>
      <Button
        href="https://camaudit.io/demo"
        style={{ ...pillCtaStyle, backgroundColor: '#2563eb' }}
      >
        See available times
      </Button>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurtureBookDemoSoft {...props} />)
  const text = await render(<CamauditNurtureBookDemoSoft {...props} />, { plainText: true })
  return { html, text }
}
