import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import {
  buildSecretTemplateJson,
  parseWranglerSecretListOutput,
  REQUIRED_PRODUCTION_SECRETS,
} from '../lib/readiness.js'

const require = createRequire(import.meta.url)

export function wranglerSecretListArgs(): string[] {
  return ['secret', 'list', '--env', 'production']
}

export function missingRemoteSecretNames(
  requiredSecrets: string[],
  secretRows: Array<{ name?: unknown }>,
): string[] {
  const presentSecretNames = new Set(
    secretRows.map((row) => row.name).filter((name): name is string => typeof name === 'string'),
  )
  return requiredSecrets.filter((secret) => !presentSecretNames.has(secret))
}

function wranglerBin(): string {
  return join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
}

function listProductionSecrets(cwd: string): Array<{ name?: unknown }> {
  const output = execFileSync(process.execPath, [wranglerBin(), ...wranglerSecretListArgs()], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseWranglerSecretListOutput(output)
}

export const secretTemplateCommand = new Command('secret-template')
  .description('Print a wrangler secret bulk JSON template for all required production secrets')
  .option('--missing-remote', 'Only include secrets missing from the production Worker')
  .option('--out <path>', 'Write the template to a file')
  .action((opts) => {
    let requiredSecrets = REQUIRED_PRODUCTION_SECRETS
    if (opts.missingRemote) {
      const apiDir = `${process.cwd()}/apps/api`
      requiredSecrets = missingRemoteSecretNames(
        REQUIRED_PRODUCTION_SECRETS,
        listProductionSecrets(apiDir),
      )
    }

    const json = buildSecretTemplateJson(requiredSecrets)
    if (opts.out) {
      const outPath = resolve(process.cwd(), opts.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, json)
      console.log(chalk.green(`Wrote ${outPath}`))
      return
    }

    console.log(json.trimEnd())
  })
