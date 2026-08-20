import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StepTable } from './SequencesPage'

describe('Sequence step table rendering', () => {
  it('renders skip_if gates instead of the old condition field', () => {
    const markup = renderToStaticMarkup(
      <StepTable
        definition={{
          steps: [
            {
              delay: '1d',
              template: 'demo-template',
              subject: 'Your weekly digest',
              condition: 'legacy-condition',
              skip_if: { reply_received: true },
            },
          ],
        }}
      />,
    )

    expect(markup).toContain('Skip if')
    expect(markup).toContain('Email subject')
    expect(markup).toContain('Your weekly digest')
    expect(markup).toContain('1 day')
    expect(markup).not.toContain('>1d<')
    expect(markup).toContain('Reply received')
    expect(markup).not.toContain('reply_received')
    expect(markup).not.toContain('legacy-condition')
    expect(markup).not.toContain('>Condition<')
  })
})
