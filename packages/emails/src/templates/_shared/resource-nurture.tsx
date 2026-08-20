import { Button, Text } from '@react-email/components'
import { render } from '@react-email/render'
import React from 'react'
import { type ProductSlug, pillCtaStyle, productBranding } from '../../branding'
import { BaseLayout } from '../../layouts/base'
import { getLeadMagnetContent } from './lead-magnet-content'

export interface ResourceNurtureProps {
  firstName?: string
  unsubscribeUrl: string
}

function isResourceNurtureProduct(product: string): product is ProductSlug {
  return getLeadMagnetContent(product) !== undefined
}

function parseResourceNurtureSlug(templateSlug: string): { product: ProductSlug } | null {
  const match = templateSlug.match(/^nurture\/(.+)-resource$/)
  if (!match) return null
  const [, product] = match
  if (!isResourceNurtureProduct(product)) return null
  return { product: product as ProductSlug }
}

export function isResourceNurtureTemplateSlug(templateSlug: string): boolean {
  return parseResourceNurtureSlug(templateSlug) !== null
}

function ResourceNurtureEmail({
  firstName,
  product,
  unsubscribeUrl,
}: ResourceNurtureProps & { product: ProductSlug }) {
  const brand = productBranding[product]
  const content = getLeadMagnetContent(product)!
  const name = firstName ?? 'there'

  return (
    <BaseLayout
      productName={brand.name}
      brandColor={brand.color}
      unsubscribeUrl={unsubscribeUrl}
      previewText={content.preview}
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        {content.headline}
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      {content.body.map((paragraph) => (
        <Text
          key={paragraph}
          style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}
        >
          {paragraph}
        </Text>
      ))}
      <Button href={content.landingUrl} style={{ ...pillCtaStyle, backgroundColor: brand.color }}>
        {content.ctaLabel}
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
        The {brand.name} team
      </Text>
    </BaseLayout>
  )
}

export async function renderResourceNurtureEmail(
  templateSlug: string,
  props: ResourceNurtureProps,
): Promise<{ html: string; text: string }> {
  const parsed = parseResourceNurtureSlug(templateSlug)
  if (!parsed) throw new Error(`Resource nurture template not found: ${templateSlug}`)

  const element = <ResourceNurtureEmail {...props} product={parsed.product} />
  const html = await render(element)
  const text = await render(element, { plainText: true })
  return { html, text }
}
