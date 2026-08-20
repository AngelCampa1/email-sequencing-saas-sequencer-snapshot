import { Button, Text } from '@react-email/components'
import { render } from '@react-email/render'
import { type ProductSlug, pillCtaStyle, productBranding } from '../../branding'
import { BaseLayout } from '../../layouts/base'

export interface GenericNurtureProps {
  firstName?: string
  unsubscribeUrl: string
}

const productDashboardUrls = {
  'floriva-web': 'https://floriva.app',
} as const satisfies Partial<Record<ProductSlug, string>>
type GenericNurtureProduct = keyof typeof productDashboardUrls

type TouchNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
type TouchContent = { preview: string; headline: string; body: string[] }
type ProductNurtureContent = Partial<Record<TouchNumber, TouchContent>> &
  Record<Exclude<TouchNumber, 1>, TouchContent>

const productNurtureContent: Record<string, ProductNurtureContent> = {
  'floriva-web': {
    2: {
      preview: 'Track your period with no account',
      headline: 'Start tracking, no account needed',
      body: [
        'Open Floriva and log your last period start date. That is all it takes to begin. You do not make an account, and your data stays on your phone.',
        'This is the core difference. Your cycle dates, symptoms, and notes stay off our servers. So a data broker or a subpoena has nothing to reach.',
      ],
    },
    3: {
      preview: 'A period app needs almost nothing',
      headline: 'Take back app permissions',
      body: [
        'A period tracker does not need your location, contacts, camera, or mic. If an old app asked for those, open your phone settings. Turn them off today.',
        'Floriva keeps this simple. It asks for almost nothing because it works on your device. Fewer permissions means fewer ways your data can slip out.',
      ],
    },
    4: {
      preview: 'Get your data off their servers',
      headline: 'Wipe your old tracker for good',
      body: [
        'Deleting an app does not always delete the data it stored about you. The company can still hold your cycle history on its servers. You often have to ask for a full delete.',
        'Send that request before you move on. Your old data is gone. Your new logs live only on your phone. The trail closes.',
      ],
    },
    5: {
      preview: 'Make Floriva fit your body',
      headline: 'Track what matters to you',
      body: [
        'Log the things you actually want to follow. Flow, pain, mood, and sleep are a good start. Over a few cycles, Floriva helps you spot your own patterns.',
        'All of this stays private. You get a smart tracker. You keep your health data to yourself.',
      ],
    },
    6: {
      preview: 'Keep your data safe and still private',
      headline: 'Back up without giving up privacy',
      body: [
        "Losing your phone should not mean losing your history. Set up Floriva's backup so your data is safe. It stays locked so the company cannot read it.",
        'This is the part most cloud apps get wrong. You keep a backup. You keep your privacy too.',
      ],
    },
    7: {
      preview: 'Help someone else take back control',
      headline: 'Pass Floriva on to a friend',
      body: [
        'If the privacy switch felt good, share it. Many people still track on apps that sell or leak their data. Most have no idea.',
        'Send Floriva to one friend who tracks her cycle. You give her an easy way to take her data back.',
      ],
    },
    8: {
      preview: 'Spot your patterns over time',
      headline: 'Look at three cycles together',
      body: [
        'One cycle tells you a little. Three cycles tell you a lot. Open Floriva and look at your last three months side by side.',
        'Notice what stays the same and what shifts. Patterns in pain, mood, or flow can point to things worth tracking more closely.',
      ],
    },
    9: {
      preview: 'Your body changes with seasons',
      headline: 'Notice how seasons affect your cycle',
      body: [
        'Sleep, light, and stress all shift through the year. Your cycle can shift too. Log a note in Floriva each month about how you feel overall.',
        'A few months of notes can show you how your body responds to the seasons. That is useful to know for planning ahead.',
      ],
    },
    10: {
      preview: 'A symptom log helps your doctor too',
      headline: 'Use Floriva before your next appointment',
      body: [
        'Doctors ask about symptoms and timing. Most people guess. You can give exact dates and patterns from Floriva instead.',
        'Before your next visit, export or screenshot your last three months. A clear log helps your doctor help you faster.',
      ],
    },
    11: {
      preview: 'Privacy is a habit, not a one-time fix',
      headline: 'Check your phone privacy settings again',
      body: [
        'App permissions can reset after an update. Take two minutes to check your phone settings today. Look at which apps can see your location, contacts, or health data.',
        'Remove any access you do not need. Your health data is yours. Keeping it private is a habit worth building.',
      ],
    },
    12: {
      preview: 'Track what affects your energy',
      headline: 'Log energy alongside your cycle',
      body: [
        'Energy levels change across your cycle. Some days feel sharp. Others feel slow. A quick note in Floriva each day helps you spot the pattern.',
        'Once you see it, you can plan for it. Schedule hard tasks on your high-energy days. Rest on the low ones.',
      ],
    },
    13: {
      preview: 'Your data should serve you',
      headline: 'Review what you track in Floriva',
      body: [
        'More data is not always better. Check which fields you log most often. Keep the ones that tell you something useful.',
        'Turn off anything you never check. A clean log is easier to read and easier to share with a doctor when it matters.',
      ],
    },
    14: {
      preview: 'You are in control. Keep tracking.',
      headline: 'Keep your private health log going',
      body: [
        'You have built a real health log. Your data stays on your phone. Your patterns are yours to use.',
        'Open Floriva today and add this cycle. A consistent log gets more useful every month you keep it.',
      ],
    },
  },
}

export function isGenericNurtureTemplateSlug(templateSlug: string): boolean {
  return parseGenericNurtureSlug(templateSlug) !== null
}

function isGenericNurtureProduct(product: string): product is GenericNurtureProduct {
  return Object.hasOwn(productDashboardUrls, product)
}

function parseGenericNurtureSlug(
  templateSlug: string,
): { product: GenericNurtureProduct; touch: TouchNumber } | null {
  const match = templateSlug.match(/^nurture\/(.+)-value-([1-9]|1[0-4])$/)
  if (!match) return null
  const [, product, touchText] = match
  if (!isGenericNurtureProduct(product)) return null
  const touch = Number(touchText) as TouchNumber
  if (touch === 1) return null
  return { product, touch }
}

function GenericNurtureEmail({
  firstName,
  product,
  touch,
  unsubscribeUrl,
}: GenericNurtureProps & { product: GenericNurtureProduct; touch: TouchNumber }) {
  const brand = productBranding[product]
  const guidance = productNurtureContent[product][touch]
  if (!guidance) {
    throw new Error(`Generic nurture template not found: nurture/${product}-value-${touch}`)
  }
  const name = firstName ?? 'there'

  return (
    <BaseLayout
      productName={brand.name}
      brandColor={brand.color}
      unsubscribeUrl={unsubscribeUrl}
      previewText={guidance.preview}
    >
      <Text style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>
        {guidance.headline}
      </Text>
      <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}>
        Hey {name},
      </Text>
      {guidance.body.map((paragraph) => (
        <Text
          key={paragraph}
          style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }}
        >
          {paragraph}
        </Text>
      ))}
      <Button
        href={productDashboardUrls[product]}
        style={{ ...pillCtaStyle, backgroundColor: brand.color }}
      >
        Open {brand.name}
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

export async function renderGenericNurtureEmail(
  templateSlug: string,
  props: GenericNurtureProps,
): Promise<{ html: string; text: string }> {
  const parsed = parseGenericNurtureSlug(templateSlug)
  if (!parsed) throw new Error(`Generic nurture template not found: ${templateSlug}`)

  const element = <GenericNurtureEmail {...props} product={parsed.product} touch={parsed.touch} />
  const html = await render(element)
  const text = await render(element, { plainText: true })
  return { html, text }
}
