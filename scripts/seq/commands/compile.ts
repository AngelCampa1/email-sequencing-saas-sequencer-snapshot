import type { SequenceDefinition } from '@sequencer/shared'
import { SequenceDefinitionSchema } from '@sequencer/shared'
import chalk from 'chalk'
import { Command } from 'commander'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { glob } from 'glob'
import yaml from 'js-yaml'
import { join, relative, resolve } from 'path'
import { validateSequenceDefinition } from '../lib/parser.js'
import { validateSequencePolicy } from '../lib/sequence-policy.js'

export const compileCommand = new Command('compile')
  .description('Validate and compile all YAML sequences to dist/sequences.json')
  .option('--no-bundle', 'Validate only, do not write bundle')
  .action(async (opts) => {
    const root = resolve(process.cwd())
    const pattern = join(root, 'sequences/**/*.yaml').replace(/\\/g, '/')
    const files = await glob(pattern)

    if (files.length === 0) {
      console.log(chalk.yellow('No sequence files found.'))
      return
    }

    const compiled: SequenceDefinition[] = []
    const seenSlugs = new Map<string, string>()
    let errors = 0

    for (const file of files) {
      const relativePath = relative(root, file)
      try {
        const raw = yaml.load(readFileSync(file, 'utf8'))
        const result = SequenceDefinitionSchema.safeParse(raw)

        if (!result.success) {
          console.error(chalk.red(`[ERR] ${relativePath}`))
          result.error.errors.forEach((e) => {
            console.error(chalk.red(`  ${e.path.join('.')}: ${e.message}`))
          })
          errors++
          continue
        }

        const def = result.data

        const previousPath = seenSlugs.get(def.slug)
        if (previousPath) {
          console.error(chalk.red(`[ERR] ${relativePath}`))
          console.error(
            chalk.red(`  Duplicate sequence slug "${def.slug}" already defined in ${previousPath}`),
          )
          errors++
          continue
        }

        const validationErrors = [
          ...validateSequenceDefinition(def),
          ...validateSequencePolicy(def),
        ]

        if (validationErrors.length > 0) {
          console.error(chalk.red(`[ERR] ${relativePath}`))
          for (const e of validationErrors) console.error(chalk.red(`  ${e}`))
          errors++
          continue
        }

        console.log(
          chalk.green(`[OK] ${relativePath}`) + chalk.gray(` (${def.steps.length} steps)`),
        )
        seenSlugs.set(def.slug, relativePath)
        compiled.push(def)
      } catch (e) {
        console.error(chalk.red(`[ERR] ${relativePath}: ${(e as Error).message}`))
        errors++
      }
    }

    console.log('')
    console.log(
      `${chalk.bold('Compiled:')} ${compiled.length} sequences, ${chalk.red(`${errors} errors`)}`,
    )

    if (errors > 0) {
      process.exit(1)
    }

    if (opts.bundle !== false) {
      mkdirSync(join(root, 'dist'), { recursive: true })
      writeFileSync(
        join(root, 'dist/sequences.json'),
        JSON.stringify({ sequences: compiled, compiled_at: new Date().toISOString() }, null, 2),
      )
      console.log(chalk.blue(`\nBundle written to dist/sequences.json`))
    }
  })
