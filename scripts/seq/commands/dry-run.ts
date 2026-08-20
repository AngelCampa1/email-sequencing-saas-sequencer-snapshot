import type { SequenceDefinition } from '@sequencer/shared'
import chalk from 'chalk'
import { Command } from 'commander'
import { readFileSync } from 'fs'
import { glob } from 'glob'
import { join, resolve } from 'path'
import { parseSequenceFile, readSequenceSlugFromText } from '../lib/parser.js'

export const dryRunCommand = new Command('dry-run')
  .description('Preview a sequence without sending (renders step table)')
  .argument('<slug>', 'Sequence slug')
  .option('--email <email>', 'Contact email for preview context', 'test@example.com')
  .action(async (slug: string, opts) => {
    const root = resolve(process.cwd())
    const foundDef = await loadDryRunSequence(root, slug)

    if (!foundDef) {
      console.error(chalk.red(`Sequence "${slug}" not found.`))
      process.exit(1)
    }

    console.log(chalk.bold(`\nDry run: ${foundDef.slug}`))
    console.log(
      chalk.gray(
        `Product: ${foundDef.product} | Goal: ${foundDef.goal ?? 'none'} | Steps: ${foundDef.steps.length}`,
      ),
    )
    console.log(chalk.gray(`Contact: ${opts.email}\n`))

    let cumulativeHours = 0
    for (const step of foundDef.steps) {
      const delay = parseDelay(step.delay)
      cumulativeHours += delay.hours
      const sendAt = new Date(Date.now() + cumulativeHours * 3600_000)
      const subject =
        typeof step.subject === 'string'
          ? step.subject
          : Object.entries(step.subject as Record<string, string>)
              .map(([v, s]) => `[${v}] ${s}`)
              .join(' / ')

      console.log(
        chalk.cyan(`  Step ${foundDef.steps.indexOf(step) + 1}: ${step.id}`) +
          chalk.gray(` (+${step.delay} -> ${sendAt.toLocaleDateString()})`),
      )
      console.log(chalk.white(`    Subject: ${subject}`))
      console.log(chalk.gray(`    Template: ${step.template}`))
      if (step.skip_if) {
        console.log(chalk.yellow(`    Skip if: ${JSON.stringify(step.skip_if)}`))
      }
      console.log('')
    }
  })

export async function loadDryRunSequence(
  root: string,
  slug: string,
  files?: string[],
): Promise<SequenceDefinition | null> {
  const sequenceFiles = files ?? (await glob(join(root, 'sequences/**/*.yaml').replace(/\\/g, '/')))

  for (const file of sequenceFiles) {
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    if (readSequenceSlugFromText(raw) !== slug) continue

    const parsed = parseSequenceFile(file)
    if (parsed.ok) return parsed.definition

    throw new Error(`Invalid sequence "${slug}" in ${file}: ${parsed.errors.join('; ')}`)
  }

  return null
}

function parseDelay(delay: string): { hours: number } {
  const match = delay.match(/^(\d+)(m|h|d)$/)
  if (!match) return { hours: 0 }
  const n = parseInt(match[1], 10)
  switch (match[2]) {
    case 'm':
      return { hours: n / 60 }
    case 'h':
      return { hours: n }
    case 'd':
      return { hours: n * 24 }
    default:
      return { hours: 0 }
  }
}
