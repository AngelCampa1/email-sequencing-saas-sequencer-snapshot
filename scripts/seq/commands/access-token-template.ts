import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { buildAccessServiceTokenTemplateJson } from '../lib/readiness.js'

export const accessTokenTemplateCommand = new Command('access-token-template')
  .description(
    'Print a Cloudflare Access service-token id collection template for all live products',
  )
  .option('--out <path>', 'Write the template to a file')
  .action((opts) => {
    const json = buildAccessServiceTokenTemplateJson()
    if (opts.out) {
      const outPath = resolve(process.cwd(), opts.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, json)
      console.log(chalk.green(`Wrote ${outPath}`))
      return
    }

    console.log(json.trimEnd())
  })
