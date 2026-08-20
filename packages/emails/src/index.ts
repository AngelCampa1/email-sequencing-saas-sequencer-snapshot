export interface TemplateProps {
  firstName?: string
  unsubscribeUrl: string
  productName?: string
  brandColor?: string
}

export { pillCtaStyle, productBranding } from './branding'
export { BaseLayout } from './layouts/base'
export { isKnownSequencerTemplateSlug, RENDERABLE_TEMPLATE_SLUGS } from './template-catalog'
export {
  isGenericNurtureTemplateSlug,
  renderGenericNurtureEmail,
} from './templates/_shared/generic-nurture'
export { getLeadMagnetContent } from './templates/_shared/lead-magnet-content'
export {
  isResourceNurtureTemplateSlug,
  renderResourceNurtureEmail,
} from './templates/_shared/resource-nurture'
// CAMAudit
export {
  default as CamauditFulfillmentChecklist,
  renderEmail as renderCamauditChecklist,
} from './templates/camaudit/fulfillment-tenant-checklist'
export { hasCamauditLegacyTemplate, renderCamauditLegacyEmail } from './templates/camaudit/legacy'
export {
  default as CamauditNurtureBookDemoDirect,
  renderEmail as renderCamauditBookDemoDirect,
} from './templates/camaudit/nurture-book-demo-direct'
export {
  default as CamauditNurtureBookDemoSoft,
  renderEmail as renderCamauditBookDemoSoft,
} from './templates/camaudit/nurture-book-demo-soft'
export {
  default as CamauditNurtureCaseStudy,
  renderEmail as renderCamauditCaseStudy,
} from './templates/camaudit/nurture-case-study'
export {
  default as CamauditNurturePartnerSelfServeCapacity,
  renderEmail as renderCamauditPartnerSelfServeCapacity,
} from './templates/camaudit/nurture-partner-self-serve-capacity'
export {
  default as CamauditNurturePartnerSelfServeDemo,
  renderEmail as renderCamauditPartnerSelfServeDemo,
} from './templates/camaudit/nurture-partner-self-serve-demo'
export {
  default as CamauditNurturePartnerSelfServeDisputeLetter,
  renderEmail as renderCamauditPartnerSelfServeDisputeLetter,
} from './templates/camaudit/nurture-partner-self-serve-dispute-letter'
export {
  default as CamauditNurturePartnerSelfServeGuarantee,
  renderEmail as renderCamauditPartnerSelfServeGuarantee,
} from './templates/camaudit/nurture-partner-self-serve-guarantee'
export {
  default as CamauditNurturePartnerSelfServeMargin,
  renderEmail as renderCamauditPartnerSelfServeMargin,
} from './templates/camaudit/nurture-partner-self-serve-margin'
export {
  default as CamauditNurtureValue1,
  renderEmail as renderCamauditValue1,
} from './templates/camaudit/nurture-value-1'
// Floriva
export {
  default as FlorivaFulfillmentWelcome,
  renderEmail as renderFlorivaWelcome,
} from './templates/floriva-web/fulfillment-welcome'
export {
  default as FlorivaNurtureValue1,
  renderEmail as renderFlorivaValue1,
} from './templates/floriva-web/nurture-value-1'
