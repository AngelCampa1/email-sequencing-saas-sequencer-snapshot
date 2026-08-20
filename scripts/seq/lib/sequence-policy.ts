import type { SequenceDefinition } from '@sequencer/shared'
import { parseDelay } from './parser.js'

const TARGET_TOUCH_COUNT = 14
const DAY_MS = 86_400_000
// Floating-point tolerance when comparing accumulated delays expressed in days.
const DAY_EPSILON = 0.05
const SELFISH_SUBJECT_PATTERN =
  /\b(did you|get a chance|checking in|check-in|quick check|quick .*setup pass|last call|ready to|just following|follow up|following up|bumping)\b/i

/**
 * Steps with id "resource" are lead-magnet delivery steps that sit outside the
 * daily nurture cadence. They are excluded from touch-count and day-window
 * checks (their delay still accumulates into the running schedule).
 */
const EXEMPT_STEP_IDS = new Set(['resource'])

function subjectText(subject: SequenceDefinition['steps'][number]['subject']): string {
  if (typeof subject === 'string') return subject
  return Object.values(subject).join(' ')
}

function cumulativeDays(steps: SequenceDefinition['steps']): number[] {
  let elapsedMs = 0
  return steps.map((step) => {
    elapsedMs += parseDelay(step.delay)
    return elapsedMs / DAY_MS
  })
}

export function validateSequencePolicy(definition: SequenceDefinition): string[] {
  const errors: string[] = []

  // Accumulate days over the FULL step list so each touch's send-day reflects
  // what contacts actually receive (delays are relative and accumulate at
  // runtime). Then drop exempt steps (e.g. resource delivery) from the
  // count/window assertions without removing their delay from the totals.
  const allDays = cumulativeDays(definition.steps)
  const cadence = definition.steps
    .map((step, i) => ({ step, day: allDays[i] }))
    .filter(({ step }) => !EXEMPT_STEP_IDS.has(step.id))
  const days = cadence.map((c) => c.day)

  // The aggressive cadence: exactly 14 touches, one per day. The first touch
  // fires immediately (day 0, e.g. welcome / magnet delivery) or one day after
  // enrollment (day 1, nurture-first). Every later touch lands one day after
  // the previous one, so all 14 emails are delivered across 14 days.
  if (cadence.length !== TARGET_TOUCH_COUNT) {
    errors.push(`Expected ${TARGET_TOUCH_COUNT} touches, found ${cadence.length}`)
  } else {
    if (days[0] > 1 + DAY_EPSILON) {
      errors.push(`First touch must land by day 1; got day ${days[0]}`)
    }
    for (let i = 1; i < days.length; i++) {
      const gap = days[i] - days[i - 1]
      if (Math.abs(gap - 1) > DAY_EPSILON) {
        errors.push(
          `Touches must be daily (one day apart); touch "${cadence[i].step.id}" lands ${gap} day(s) after the previous touch`,
        )
      }
    }
    if (days[days.length - 1] > 14 + DAY_EPSILON) {
      errors.push(`All 14 touches must land within 14 days; got days ${days.join(', ')}`)
    }
  }

  for (const step of definition.steps) {
    const subject = subjectText(step.subject)
    if (SELFISH_SUBJECT_PATTERN.test(subject)) {
      errors.push(`Step "${step.id}" uses a selfish reminder subject: ${subject}`)
    }
  }

  return errors
}
