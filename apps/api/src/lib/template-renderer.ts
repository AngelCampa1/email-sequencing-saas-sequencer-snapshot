import type { TemplateProps } from '@sequencer/emails'

const legacyCamauditPrefix = 'legacy/camaudit/'

const templateMap: Record<
  string,
  () => Promise<{ renderEmail: (p: TemplateProps) => Promise<{ html: string; text: string }> }>
> = {
  'lead-magnets/tenant-checklist-delivery': () =>
    import('@sequencer/emails/templates/camaudit/fulfillment-tenant-checklist'),
  'nurture/cam-audit-value-1': () => import('@sequencer/emails/templates/camaudit/nurture-value-1'),
  'nurture/cam-case-study': () => import('@sequencer/emails/templates/camaudit/nurture-case-study'),
  'nurture/book-demo-soft': () =>
    import('@sequencer/emails/templates/camaudit/nurture-book-demo-soft'),
  'nurture/book-demo-direct': () =>
    import('@sequencer/emails/templates/camaudit/nurture-book-demo-direct'),
  'nurture/camaudit-partner-self-serve-demo': () =>
    import('@sequencer/emails/templates/camaudit/nurture-partner-self-serve-demo'),
  'nurture/camaudit-partner-self-serve-dispute-letter': () =>
    import('@sequencer/emails/templates/camaudit/nurture-partner-self-serve-dispute-letter'),
  'nurture/camaudit-partner-self-serve-margin': () =>
    import('@sequencer/emails/templates/camaudit/nurture-partner-self-serve-margin'),
  'nurture/camaudit-partner-self-serve-guarantee': () =>
    import('@sequencer/emails/templates/camaudit/nurture-partner-self-serve-guarantee'),
  'nurture/camaudit-partner-self-serve-capacity': () =>
    import('@sequencer/emails/templates/camaudit/nurture-partner-self-serve-capacity'),
  'onboarding/floriva-web-welcome': () =>
    import('@sequencer/emails/templates/floriva-web/fulfillment-welcome'),
  'nurture/floriva-web-value-1': () =>
    import('@sequencer/emails/templates/floriva-web/nurture-value-1'),
}

export class TemplateNotFoundError extends Error {
  constructor(readonly templateSlug: string) {
    super(`Template not found: ${templateSlug}`)
    this.name = 'TemplateNotFoundError'
  }
}

export async function renderEmailForTemplate(
  templateSlug: string,
  props: TemplateProps & Record<string, unknown>,
): Promise<{ html: string; text: string }> {
  if (templateSlug.startsWith(legacyCamauditPrefix)) {
    const { hasCamauditLegacyTemplate, renderCamauditLegacyEmail } = await import(
      '@sequencer/emails'
    )
    const legacyTemplateSlug = templateSlug.slice(legacyCamauditPrefix.length)
    if (!hasCamauditLegacyTemplate(legacyTemplateSlug)) {
      throw new TemplateNotFoundError(templateSlug)
    }

    return renderCamauditLegacyEmail({
      templateSlug: legacyTemplateSlug,
      unsubscribeUrl: props.unsubscribeUrl,
      subject: typeof props.subject === 'string' ? props.subject : undefined,
    })
  }

  const {
    isGenericNurtureTemplateSlug,
    renderGenericNurtureEmail,
    isResourceNurtureTemplateSlug,
    renderResourceNurtureEmail,
  } = await import('@sequencer/emails')
  if (isGenericNurtureTemplateSlug(templateSlug)) {
    return renderGenericNurtureEmail(templateSlug, {
      firstName: props.firstName,
      unsubscribeUrl: props.unsubscribeUrl,
    })
  }

  if (isResourceNurtureTemplateSlug(templateSlug)) {
    return renderResourceNurtureEmail(templateSlug, {
      firstName: props.firstName,
      unsubscribeUrl: props.unsubscribeUrl,
    })
  }

  const loader = templateMap[templateSlug]
  if (!loader) {
    throw new TemplateNotFoundError(templateSlug)
  }

  const mod = await loader()
  return mod.renderEmail(props)
}

export async function isRenderableTemplate(templateSlug: string): Promise<boolean> {
  if (templateSlug.startsWith(legacyCamauditPrefix)) {
    const { hasCamauditLegacyTemplate } = await import('@sequencer/emails')
    return hasCamauditLegacyTemplate(templateSlug.slice(legacyCamauditPrefix.length))
  }

  const { isGenericNurtureTemplateSlug, isResourceNurtureTemplateSlug } = await import(
    '@sequencer/emails'
  )
  if (isGenericNurtureTemplateSlug(templateSlug)) return true
  if (isResourceNurtureTemplateSlug(templateSlug)) return true

  return Object.hasOwn(templateMap, templateSlug)
}
