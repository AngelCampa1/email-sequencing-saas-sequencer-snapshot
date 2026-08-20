import { CAMAUDIT_LEGACY_TEMPLATE_META, CAMAUDIT_LEGACY_TEMPLATES } from './legacy-data'

export interface CamauditLegacyTemplateProps {
  templateSlug: string
  unsubscribeUrl: string
  subject?: string
}

const CAMAUDIT_ORIGIN = 'https://camaudit.io'
const CAMAUDIT_EXTENSION_TEMPLATES: Record<string, { headline: string; body: string[] }> = {
  sequence_value_4: {
    headline: 'Separate the issue from the evidence',
    body: [
      'A CAM finding is easier to evaluate when the issue and evidence are separated. State the disputed charge in one line, then attach the lease clause, schedule page, and math that support it.',
      'That structure helps reviewers see whether the problem is a lease interpretation, a calculation error, a missing backup file, or a timing issue.',
    ],
  },
  sequence_value_5: {
    headline: 'Turn the guide into a review checklist',
    body: [
      'The useful next step is to convert the guide into a short review checklist: lease clause, reconciliation line item, supporting schedule, and dispute window.',
      'That format makes the issue easier to hand to finance, a tenant rep, outside counsel, or an audit partner because each finding has evidence attached instead of only a conclusion.',
    ],
  },
  sequence_value_6: {
    headline: 'Keep the evidence trail clean',
    body: [
      'A strong CAM review depends on the trail around the charge: the lease language, the landlord statement, backup schedules, correspondence, and the date each file was received.',
      'Save those pieces together before the next reconciliation cycle. The evidence trail often matters as much as the overcharge estimate when someone has to decide whether to escalate.',
    ],
  },
  sequence_value_7: {
    headline: 'Use a simple threshold before escalating',
    body: [
      'Not every variance deserves a dispute. Sort findings by dollar exposure, lease support, deadline risk, and relationship sensitivity before deciding what to pursue.',
      'That threshold keeps the review practical. It helps teams act on material errors while avoiding low-value arguments that cost more attention than they return.',
    ],
  },
  sequence_value_8: {
    headline: 'How a gross-up clause can raise your share',
    body: [
      'A gross-up clause lets a landlord bill some costs as if the building were full, even when it is not. The idea is fair on its own. The risk is in how the math gets applied.',
      'Check which expenses were grossed up and what occupancy rate was used. A small change in that rate can move your share by a lot. The lease should say which costs qualify, so read that line first.',
    ],
  },
  sequence_value_9: {
    headline: 'Base year errors repeat every single year',
    body: [
      'In many leases your costs are measured against a base year. If that first year is set too low, you pay the gap again and again for the life of the lease.',
      'It is worth checking the base year once, with care. Compare it against the actual expenses for that year. A correction made early can save money on every statement that follows.',
    ],
  },
  sequence_value_10: {
    headline: 'A cap only helps if someone tracks it',
    body: [
      'Some leases cap how much controllable costs can rise each year. The cap is only useful if you check the statement against it. Caps are easy to write down and easy to forget.',
      'Keep a short record of the cap rate and the running total. When a new statement arrives, compare the increase to the cap. If the rise is larger, ask for the detail behind it.',
    ],
  },
  sequence_value_11: {
    headline: 'How to read a year-end reconciliation',
    body: [
      'The year-end statement compares what you paid in estimates to the final actual costs. The result is a credit or a bill. The number alone does not tell you if it is correct.',
      'Ask for the line-item detail behind the total. Match each large category to the lease and to last year. A clear, side-by-side view makes a wrong charge much easier to spot.',
    ],
  },
  sequence_value_12: {
    headline: 'The costs that land in the wrong bucket',
    body: [
      'Capital projects, management fees, and repairs are the categories that most often get sorted into the wrong place. A capital cost billed as a yearly expense can raise your share by a lot.',
      'Look at the biggest line items first. Ask whether each one fits the lease definition for that category. The goal is simple: every charge should sit in the bucket the lease allows.',
    ],
  },
  sequence_value_13: {
    headline: 'Know your audit rights and the deadline',
    body: [
      'Most leases give the tenant a window to review the landlord statement and ask questions. That window often closes a set number of days after the statement arrives.',
      'Find the clause that covers this right and write the deadline on your calendar. A right you do not use on time can be lost. Knowing the date keeps the option open.',
    ],
  },
  sequence_value_14: {
    headline: 'A yearly habit that keeps CAM in check',
    body: [
      'The best protection is a simple yearly routine. When the statement arrives, gather the lease, the prior year, and the backup detail in one place before you review.',
      'A short, steady review each year catches errors while they are still small. If you would like a faster first pass, you can run your statement through a CAM review and see what stands out.',
    ],
  },
}

function absoluteCamauditUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${CAMAUDIT_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

function renderTemplate(html: string, props: CamauditLegacyTemplateProps): string {
  const meta = CAMAUDIT_LEGACY_TEMPLATE_META[props.templateSlug]
  const ctaTarget = meta ? absoluteCamauditUrl(meta.ctaPath) : `${CAMAUDIT_ORIGIN}/scan`

  return html
    .replace(
      /(<a\b(?=[^>]*background-color:)[\s\S]*?border-radius:\s*)12px(;)/g,
      (_match, before, after) => `${before}999px${after}`,
    )
    .replaceAll('__CAM_SUBJECT__', props.subject ?? meta?.title ?? 'CAMAudit')
    .replaceAll('__CAM_UNSUBSCRIBE_URL__', props.unsubscribeUrl)
    .replaceAll('__CAM_SCAN_URL__', `${CAMAUDIT_ORIGIN}/scan`)
    .replaceAll('__CAM_CTA_TARGET__', ctaTarget)
    .replaceAll('__CAM_DOWNLOAD_URL__', ctaTarget)
    .replaceAll('__CAM_GUIDE_TITLE__', meta?.title ?? 'CAMAudit guide')
    .replaceAll('__CAM_AUDIENCE__', meta?.audience ?? 'tenant')
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderExtensionTemplate(templateSlug: string, props: CamauditLegacyTemplateProps): string {
  const template = CAMAUDIT_EXTENSION_TEMPLATES[templateSlug]
  const subject = props.subject ?? template.headline
  const paragraphs = template.body
    .map(
      (body) =>
        `<p style="color: #586b83; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${body}</p>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 48px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 600px; width: 100%;">
          <tr>
            <td align="center" style="background-color: #D8E9F4; border-radius: 12px 12px 0 0; padding: 48px 32px;">
              <img src="https://camaudit.io/email-logo.png" alt="CAMAudit.io" width="160" height="50" style="display: block; width: 160px; height: 50px; margin: 0 auto;">
            </td>
          </tr>
          <tr><td style="background-color: #d97706; font-size: 0; line-height: 0; height: 4px;">&nbsp;</td></tr>
          <tr>
            <td style="padding: 32px 48px;">
              <h1 style="color: #0f172a; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 24px; line-height: 1.3; margin: 0 0 16px;">${template.headline}</h1>
              ${paragraphs}
              <p style="margin: 0 0 24px;">
                <a href="${CAMAUDIT_ORIGIN}/scan" style="background-color: #2e7d71; border-radius: 999px; color: #ffffff; display: inline-block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; font-weight: 600; line-height: 1; padding: 24px 48px; text-decoration: none;">Run a CAM review</a>
              </p>
              <p style="font-size: 11px; color: #586b83; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px 0 0;"><a href="${props.unsubscribeUrl}" style="color: #586b83;">Unsubscribe</a> from these emails.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; border-radius: 0 0 12px 12px; padding: 32px 48px 24px;">
              <p style="color: #94a3b8; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; margin: 0 0 16px; text-align: center; text-transform: uppercase;">CAMAUDIT.IO</p>
              <p style="color: #586b83; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">CAMAudit is a document analysis tool, not a law firm. Our findings are not legal or financial advice. Consult a licensed professional before taking action.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function renderCamauditLegacyEmail(
  props: CamauditLegacyTemplateProps,
): Promise<{ html: string; text: string }> {
  const template = CAMAUDIT_LEGACY_TEMPLATES[props.templateSlug]
  if (!template && Object.hasOwn(CAMAUDIT_EXTENSION_TEMPLATES, props.templateSlug)) {
    const html = renderExtensionTemplate(props.templateSlug, props)
    return { html, text: htmlToText(html) }
  }
  if (!template) {
    throw new Error(`CAMAudit legacy template not found: ${props.templateSlug}`)
  }

  const html = renderTemplate(template, props)
  return { html, text: htmlToText(html) }
}

export function hasCamauditLegacyTemplate(templateSlug: string): boolean {
  return (
    Object.hasOwn(CAMAUDIT_LEGACY_TEMPLATES, templateSlug) ||
    Object.hasOwn(CAMAUDIT_EXTENSION_TEMPLATES, templateSlug)
  )
}
