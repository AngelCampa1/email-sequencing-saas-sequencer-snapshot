import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SequenceDefinitionSchema } from '@sequencer/shared'
import { globSync } from 'glob'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  isRenderableTemplate,
  renderEmailForTemplate,
  TemplateNotFoundError,
} from '../lib/template-renderer'

function extractButtonRadii(html: string) {
  return [...html.matchAll(/<a\b(?=[^>]*background-color:)[^>]*border-radius:\s*([^;"]+)/g)].map(
    (match) => match[1].trim(),
  )
}

describe('sequence template renderer coverage', () => {
  it('renders every template referenced by compiled sequence YAML', async () => {
    const root = process.cwd()
    const files = globSync(join(root, 'sequences/**/*.yaml').replace(/\\/g, '/'))
    const templateSlugs = new Set<string>()
    const products = new Set<string>()

    for (const file of files) {
      const raw = yaml.load(readFileSync(file, 'utf8'))
      const definition = SequenceDefinitionSchema.parse(raw)
      products.add(definition.product)
      for (const step of definition.steps) {
        templateSlugs.add(step.template)
      }
    }

    expect(templateSlugs.size).toBeGreaterThan(0)
    expect([...products].sort()).toEqual(['camaudit', 'floriva-web'])

    for (const slug of templateSlugs) {
      const rendered = await renderEmailForTemplate(slug, {
        firstName: 'Preview',
        productName: 'Preview Product',
        unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
      })

      expect(rendered.html, `${slug} html`).not.toContain(`Template not found: ${slug}`)
      expect(rendered.text, `${slug} text`).not.toContain(`Template not found: ${slug}`)
      expect(rendered.html.length, `${slug} html length`).toBeGreaterThan(100)
      expect(rendered.text.length, `${slug} text length`).toBeGreaterThan(20)

      const buttonRadii = extractButtonRadii(rendered.html)
      if (buttonRadii.length > 0) {
        expect(buttonRadii, `${slug} CTA radii`).toEqual(buttonRadii.map(() => '999px'))
      }
    }
  }, 60_000)

  it('renders dedicated CAMAudit nurture templates for case study and demo steps', async () => {
    const props = {
      firstName: 'Preview',
      productName: 'CAMAudit',
      unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
    }

    await expect(renderEmailForTemplate('nurture/cam-case-study', props)).resolves.toMatchObject({
      text: expect.stringContaining('case study'),
    })
    await expect(renderEmailForTemplate('nurture/book-demo-soft', props)).resolves.toMatchObject({
      text: expect.stringContaining('demo'),
    })
    await expect(renderEmailForTemplate('nurture/book-demo-direct', props)).resolves.toMatchObject({
      text: expect.stringContaining('Book a demo'),
    })
  }, 60_000)

  it('fails closed for unknown template slugs', async () => {
    await expect(
      renderEmailForTemplate('missing/template', {
        firstName: 'Preview',
        productName: 'Preview Product',
        unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError)
  })

  it('reports renderability without advertising missing template slugs', async () => {
    await expect(isRenderableTemplate('lead-magnets/tenant-checklist-delivery')).resolves.toBe(true)
    await expect(isRenderableTemplate('legacy/camaudit/abstraction_step_1')).resolves.toBe(true)
    await expect(isRenderableTemplate('missing/template')).resolves.toBe(false)
    await expect(isRenderableTemplate('legacy/camaudit/missing-template')).resolves.toBe(false)

    await expect(
      renderEmailForTemplate('legacy/camaudit/missing-template', {
        firstName: 'Preview',
        productName: 'Preview Product',
        unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError)
  })

  it('renders generic live-product nurture value touches', async () => {
    const { html, text } = await renderEmailForTemplate('nurture/floriva-web-value-5', {
      firstName: 'Alex',
      productName: 'Floriva',
      unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
    })

    expect(html).toContain('<!DOCTYPE html')
    expect(text).toContain('Floriva')
    expect(text).toContain('Alex')
    await expect(isRenderableTemplate('nurture/floriva-web-value-5')).resolves.toBe(true)
  })

  it('renders resource nurture template for floriva-web', async () => {
    const props = {
      firstName: 'Alex',
      productName: 'Floriva',
      unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
    }
    const { html, text } = await renderEmailForTemplate('nurture/floriva-web-resource', props)
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('floriva.app/free/period-app-privacy-audit-checklist')
    expect(text).toContain('Floriva')
    await expect(isRenderableTemplate('nurture/floriva-web-resource')).resolves.toBe(true)
    await expect(isRenderableTemplate('nurture/unknown-resource')).resolves.toBe(false)
  })

  it('renders generic CAMAudit extension touches', async () => {
    const { html, text } = await renderEmailForTemplate('legacy/camaudit/sequence_value_6', {
      firstName: 'Preview',
      productName: 'CAMAudit',
      subject: 'A CAM evidence trail worth keeping',
      unsubscribeUrl: 'https://sequencer.ventoralabs.com/unsubscribe?preview=1',
    })

    expect(html).toContain('<!DOCTYPE html')
    expect(text).toContain('CAM')
    expect(text).toContain('evidence')
    await expect(isRenderableTemplate('legacy/camaudit/sequence_value_6')).resolves.toBe(true)
  })
})
