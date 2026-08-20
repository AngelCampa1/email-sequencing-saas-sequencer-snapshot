import { Link, Text } from '@react-email/components'
import { render } from '@react-email/render'
import React from 'react'
import { BaseLayout } from '../../layouts/base'

export interface TemplateProps {
  firstName?: string
  unsubscribeUrl: string
  productName?: string
}

export default function CamauditNurtureValue1({ firstName, unsubscribeUrl }: TemplateProps) {
  const name = firstName ?? 'there'
  return (
    <BaseLayout
      productName="CAMAudit"
      brandColor="#1e40af"
      unsubscribeUrl={unsubscribeUrl}
      previewText="One thing most tenants miss in their CAM audit"
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        The reconciliation error most tenants walk right past
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        When tenants audit their CAM statements, the first thing they check is the total. That's
        understandable, but it's often not where the money is hiding.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        The most common error we see:{' '}
        <strong>operating expense exclusions that weren't actually excluded</strong>.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Most commercial leases list expenses the landlord can't pass through: capital improvements,
        management fees above a cap, depreciation, executive salaries. But at reconciliation time,
        those items quietly show up in the pool anyway. The landlord's property management software
        doesn't always flag them. And if you're not scrutinizing line-by-line, neither will you.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        A few things worth checking in your next reconciliation statement:
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 8px' }}>
        <strong>1. Management fee cap.</strong> Your lease probably caps management fees at 3-5% of
        gross revenues. Compare what's listed to the actual gross revenue for the period.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 8px' }}>
        <strong>2. Capital vs. repairs.</strong> A roof replacement isn't a repair. If it's in your
        CAM pool, that's a problem. Repairs are fine; capital expenditures usually aren't.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        <strong>3. Ground-floor vs. building-wide allocations.</strong> If your lease covers only
        part of a building, your pro-rata share calculation matters as much as the expense total.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        None of this requires a lawyer on retainer. It requires knowing what to look for and doing
        the arithmetic.
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 24px' }}>
        More on this next week.
      </Text>
      <Text
        style={{
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.6',
          margin: '0 0 0',
          borderTop: '1px solid #e5e7eb',
          paddingTop: '16px',
        }}
      >
        P.S. CAMAudit automates exactly this kind of line-item review. If you'd rather not do the
        spreadsheet work yourself,{' '}
        <Link href="https://camaudit.io" style={{ color: '#1e40af' }}>
          take a look
        </Link>
        .
      </Text>
    </BaseLayout>
  )
}

export async function renderEmail(props: TemplateProps): Promise<{ html: string; text: string }> {
  const html = await render(<CamauditNurtureValue1 {...props} />)
  const text = await render(<CamauditNurtureValue1 {...props} />, { plainText: true })
  return { html, text }
}
