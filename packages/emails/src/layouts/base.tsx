import { Body, Container, Head, Hr, Html, Img, Link, Section, Text } from '@react-email/components'
import type React from 'react'
import { productBranding } from '../branding'

interface BaseLayoutProps {
  children: React.ReactNode
  productName: string
  brandColor?: string
  logoUrl?: string
  unsubscribeUrl: string
  previewText?: string
}

export function BaseLayout({
  children,
  productName,
  brandColor = '#3b82f6',
  logoUrl,
  unsubscribeUrl,
  previewText,
}: BaseLayoutProps) {
  const brand = Object.values(productBranding).find((entry) => entry.name === productName)
  const resolvedLogoUrl = logoUrl ?? brand?.logoUrl

  return (
    <Html lang="en">
      <Head>{previewText && <meta name="x-preview-text" content={previewText} />}</Head>
      <Body
        style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: '#f9fafb',
          margin: 0,
          padding: 0,
        }}
      >
        {previewText && (
          <div style={{ display: 'none', maxHeight: 0, overflow: 'hidden', color: '#f9fafb' }}>
            {previewText}
            {' ‌'.repeat(100)}
          </div>
        )}
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '24px 16px' }}>
          <Section style={{ marginBottom: '24px', textAlign: 'center' as const }}>
            {resolvedLogoUrl ? (
              <Img
                src={resolvedLogoUrl}
                alt={productName}
                width="180"
                style={{
                  display: 'block',
                  margin: '0 auto',
                  maxWidth: '180px',
                  width: '180px',
                  height: 'auto',
                }}
              />
            ) : (
              <Text style={{ fontSize: '16px', fontWeight: 700, color: brandColor, margin: 0 }}>
                {productName}
              </Text>
            )}
          </Section>

          <Section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '32px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {children}
          </Section>

          <Section style={{ marginTop: '24px', textAlign: 'center' as const }}>
            <Hr style={{ borderColor: '#e5e7eb', margin: '0 0 16px' }} />
            <Text style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>
              {productName} ·{' '}
              <Link href={unsubscribeUrl} style={{ color: '#6b7280' }}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
