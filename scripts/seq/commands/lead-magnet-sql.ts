import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { buildRequiredLeadMagnetSeedSql } from '../lib/readiness.js'

export const leadMagnetSqlCommand = new Command('lead-magnet-sql')
  .description('Print required seq_lead_magnets seed SQL')
  .option('--out <path>', 'Write the SQL to a file')
  .action((opts) => {
    const sql = `${buildRequiredLeadMagnetSeedSql()}\n`
    if (opts.out) {
      const outPath = resolve(process.cwd(), opts.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, sql)
      console.log(chalk.green(`Wrote ${outPath}`))
      return
    }

    console.log(sql.trimEnd())
  })
