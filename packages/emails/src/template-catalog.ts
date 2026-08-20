import { isGenericNurtureTemplateSlug } from './templates/_shared/generic-nurture'
import { isResourceNurtureTemplateSlug } from './templates/_shared/resource-nurture'
import { hasCamauditLegacyTemplate } from './templates/camaudit/legacy'

const legacyCamauditPrefix = 'legacy/camaudit/'

export const RENDERABLE_TEMPLATE_SLUGS = [
  'lead-magnets/tenant-checklist-delivery',
  'nurture/cam-audit-value-1',
  'nurture/cam-case-study',
  'nurture/book-demo-soft',
  'nurture/book-demo-direct',
  'nurture/camaudit-partner-self-serve-demo',
  'nurture/camaudit-partner-self-serve-dispute-letter',
  'nurture/camaudit-partner-self-serve-margin',
  'nurture/camaudit-partner-self-serve-guarantee',
  'nurture/camaudit-partner-self-serve-capacity',
  'onboarding/floriva-web-welcome',
  'nurture/floriva-web-value-1',
] as const

const renderableTemplateSlugSet = new Set<string>(RENDERABLE_TEMPLATE_SLUGS)

export function isKnownSequencerTemplateSlug(templateSlug: string): boolean {
  if (templateSlug.startsWith(legacyCamauditPrefix)) {
    return hasCamauditLegacyTemplate(templateSlug.slice(legacyCamauditPrefix.length))
  }

  if (isGenericNurtureTemplateSlug(templateSlug)) return true
  if (isResourceNurtureTemplateSlug(templateSlug)) return true

  return renderableTemplateSlugSet.has(templateSlug)
}
