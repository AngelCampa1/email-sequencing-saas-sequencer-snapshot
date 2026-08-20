import type { TemplateProps } from '@sequencer/emails'
import { buildSignedUnsubscribeUrl } from './unsubscribe-token'

interface EmailTemplateBrandingInput {
  contactEmail: string
  firstName?: string | null
  productSlug: string
  productName: string
  brandColor: string
  subject: string
  sequenceSlug: string
  unsubscribeSigningSecret: string
}

export async function buildEmailTemplateProps(
  input: EmailTemplateBrandingInput,
): Promise<TemplateProps & Record<string, unknown>> {
  return {
    firstName: input.firstName ?? undefined,
    unsubscribeUrl: await buildSignedUnsubscribeUrl({
      baseUrl: 'https://sequencer.ventoralabs.com/unsubscribe',
      email: input.contactEmail,
      product: input.productSlug,
      secret: input.unsubscribeSigningSecret,
    }),
    productName: input.productName,
    brandColor: input.brandColor,
    subject: input.subject,
    sequenceSlug: input.sequenceSlug,
  }
}
