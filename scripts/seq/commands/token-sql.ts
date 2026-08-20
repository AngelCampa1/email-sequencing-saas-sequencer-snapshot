import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { buildApiTokenSeedSql, parseAccessServiceTokenTemplate } from '../lib/readiness.js'

type TokenSqlOptions = {
  accessTokenFile?: string
  allowPlaceholders?: boolean
  out?: string
}

export function buildTokenSqlOutput(opts: TokenSqlOptions): string {
  if (opts.out && !opts.accessTokenFile && !opts.allowPlaceholders) {
    throw new Error(
      'Refusing to write placeholder seq_api_tokens SQL to a file; pass --access-token-file or --allow-placeholders',
    )
  }

  let serviceTokenIds: Map<string, string> | undefined
  if (opts.accessTokenFile) {
    serviceTokenIds = parseAccessServiceTokenTemplate(
      readFileSync(resolve(process.cwd(), opts.accessTokenFile), 'utf8'),
    )
  }

  return `${buildApiTokenSeedSql(serviceTokenIds)}\n`
}

export const tokenSqlCommand = new Command('token-sql')
  .description('Print seq_api_tokens seed SQL placeholders for all live products')
  .option('--out <path>', 'Write the SQL to a file')
  .option(
    '--access-token-file <path>',
    'Read filled access-service-tokens template and emit real token SQL',
  )
  .option('--allow-placeholders', 'Allow --out to write placeholder template SQL')
  .action((opts) => {
    let sql: string
    try {
      sql = buildTokenSqlOutput(opts)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(chalk.red(message))
      process.exit(1)
    }

    if (opts.out) {
      const outPath = resolve(process.cwd(), opts.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, sql)
      console.log(chalk.green(`Wrote ${outPath}`))
      return
    }

    console.log(sql.trimEnd())
  })
