import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { buildRequiredLeadMagnetAssetUploadPlan } from '../lib/readiness.js'

export const leadMagnetAssetsCommand = new Command('lead-magnet-assets')
  .description('Print required product lead magnet R2 verification PowerShell commands')
  .option('--out <path>', 'Write the PowerShell verification commands to a file')
  .action((opts) => {
    const plan = `${buildRequiredLeadMagnetAssetUploadPlan()}\n`
    if (opts.out) {
      const outPath = resolve(process.cwd(), opts.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, plan)
      console.log(chalk.green(`Wrote ${outPath}`))
      return
    }

    console.log(plan.trimEnd())
  })
