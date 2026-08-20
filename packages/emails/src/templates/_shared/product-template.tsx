import { Button, Text } from '@react-email/components'
import { render } from '@react-email/render'
import React from 'react'
import { pillCtaStyle } from '../../branding'
import { BaseLayout } from '../../layouts/base'

export interface ProductTemplateProps {
  firstName?: string
  unsubscribeUrl: string
  productName?: string
  brandColor?: string
}

interface ProductTemplateConfig {
  productName: string
  brandColor: string
  dashboardUrl: string
  welcomeHeadline: string
  welcomeBody: readonly string[]
  welcomeCta: string
  nurturePreview: string
  nurtureHeadline: string
  nurtureBody: readonly string[]
}

const textStyle = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: '1.6',
  margin: '0 0 16px',
}

export function createFulfillmentTemplate(config: ProductTemplateConfig) {
  function FulfillmentWelcome({ firstName, unsubscribeUrl }: ProductTemplateProps) {
    const name = firstName ?? 'there'
    return (
      <BaseLayout
        productName={config.productName}
        brandColor={config.brandColor}
        unsubscribeUrl={unsubscribeUrl}
        previewText={`Welcome to ${config.productName}`}
      >
        <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
          {config.welcomeHeadline}, {name}
        </Text>
        {config.welcomeBody.map((body) => (
          <Text key={body} style={textStyle}>
            {body}
          </Text>
        ))}
        <Button
          href={config.dashboardUrl}
          style={{ ...pillCtaStyle, backgroundColor: config.brandColor }}
        >
          {config.welcomeCta}
        </Button>
        <Text style={{ ...textStyle, margin: '24px 0 0' }}>The {config.productName} team</Text>
      </BaseLayout>
    )
  }

  async function renderEmail(props: ProductTemplateProps): Promise<{ html: string; text: string }> {
    const html = await render(<FulfillmentWelcome {...props} />)
    const text = await render(<FulfillmentWelcome {...props} />, { plainText: true })
    return { html, text }
  }

  return { Component: FulfillmentWelcome, renderEmail }
}

export function createNurtureTemplate(config: ProductTemplateConfig) {
  function NurtureValue1({ firstName, unsubscribeUrl }: ProductTemplateProps) {
    const name = firstName ?? 'there'
    return (
      <BaseLayout
        productName={config.productName}
        brandColor={config.brandColor}
        unsubscribeUrl={unsubscribeUrl}
        previewText={config.nurturePreview}
      >
        <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
          {config.nurtureHeadline}
        </Text>
        <Text style={textStyle}>Hey {name},</Text>
        {config.nurtureBody.map((body) => (
          <Text key={body} style={textStyle}>
            {body}
          </Text>
        ))}
        <Text style={{ ...textStyle, margin: '0' }}>The {config.productName} team</Text>
      </BaseLayout>
    )
  }

  async function renderEmail(props: ProductTemplateProps): Promise<{ html: string; text: string }> {
    const html = await render(<NurtureValue1 {...props} />)
    const text = await render(<NurtureValue1 {...props} />, { plainText: true })
    return { html, text }
  }

  return { Component: NurtureValue1, renderEmail }
}
