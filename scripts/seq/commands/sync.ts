import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { LIVE_PRODUCTS } from '../lib/readiness.js'
import { assertValidD1DatabaseName } from './readiness.js'

const require = createRequire(import.meta.url)

interface CompiledSequence {
  slug: string
  product: string
  version: number
  goal?: string
  exit_conditions: Array<{ event: string }>
  steps: unknown[]
  variants?: unknown[]
  [k: string]: unknown
}

interface Bundle {
  sequences: CompiledSequence[]
  compiled_at: string
}

const PRODUCT_ID_BY_SLUG: Record<string, string> = Object.fromEntries(
  LIVE_PRODUCTS.map((product) => [product.slug, product.id]),
)

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildSyncStatements(bundle: Bundle, gitSha: string): string[] {
  const statements: string[] = []
  const compiledSlugs = new Set<string>()
  const guardValues: string[] = []

  for (const sequence of bundle.sequences) {
    const productId = PRODUCT_ID_BY_SLUG[sequence.product]
    if (!productId) {
      throw new Error(`Unknown product slug: ${sequence.product} (sequence: ${sequence.slug})`)
    }
    compiledSlugs.add(sequence.slug)
    guardValues.push(`(${sqlString(sequence.slug)}, ${sqlString(productId)})`)
  }

  if (guardValues.length > 0) {
    statements.push(
      `WITH compiled_sequences(slug, product_id) AS (VALUES ${guardValues.join(', ')}) ` +
        `INSERT INTO seq_sequences (slug, product_id, version, definition, exit_conditions, is_active, compiled_at, compiled_from_sha) ` +
        `SELECT NULL, ${sqlString(LIVE_PRODUCTS[0]!.id)}, 0, ${sqlString(
          JSON.stringify({
            error: 'Sequence slug cannot move products',
          }),
        )}, '[]', 0, ${sqlString(bundle.compiled_at)}, ${sqlString(gitSha)} ` +
        `WHERE EXISTS (` +
        `SELECT 1 FROM seq_sequences existing ` +
        `JOIN compiled_sequences compiled ON compiled.slug = existing.slug ` +
        `WHERE existing.product_id <> compiled.product_id` +
        `);`,
    )
  }

  for (const sequence of bundle.sequences) {
    const productId = PRODUCT_ID_BY_SLUG[sequence.product]!

    const definitionJson = JSON.stringify(sequence)
    const exitJson = JSON.stringify(sequence.exit_conditions ?? [])
    statements.push(
      `INSERT INTO seq_sequences (slug, product_id, version, definition, goal, exit_conditions, is_active, compiled_at, compiled_from_sha) ` +
        `VALUES (${sqlString(sequence.slug)}, ${sqlString(productId)}, ${sequence.version}, ${sqlString(definitionJson)}, ${sequence.goal ? sqlString(sequence.goal) : 'NULL'}, ${sqlString(exitJson)}, 1, ${sqlString(bundle.compiled_at)}, ${sqlString(gitSha)}) ` +
        `ON CONFLICT(slug) DO UPDATE SET version=excluded.version, definition=excluded.definition, goal=excluded.goal, exit_conditions=excluded.exit_conditions, is_active=excluded.is_active, compiled_at=excluded.compiled_at, compiled_from_sha=excluded.compiled_from_sha;`,
    )
  }

  const liveProductIds = LIVE_PRODUCTS.map((product) => sqlString(product.id)).join(', ')
  const slugFilter =
    compiledSlugs.size > 0
      ? `AND slug NOT IN (${[...compiledSlugs].sort().map(sqlString).join(', ')})`
      : ''
  statements.push(
    `UPDATE seq_sequences ` +
      `SET is_active = 0, compiled_at = ${sqlString(bundle.compiled_at)}, compiled_from_sha = ${sqlString(gitSha)} ` +
      `WHERE is_active = 1 AND product_id IN (${liveProductIds}) ${slugFilter};`,
  )
  return statements
}

export function wranglerD1ExecuteArgs(
  database: string,
  target: '--local' | '--remote',
  sqlFile: string,
  env?: string,
): string[] {
  const args = ['d1', 'execute', assertValidD1DatabaseName(database), target]
  if (env) args.push('--env', env)
  args.push('--config', 'apps/api/wrangler.toml', '--file', sqlFile)
  return args
}

export function resolveGitSha(
  root: string,
  override: string | undefined,
  requireResolved: boolean,
  execGit: (
    command: string,
    args: string[],
    options: { cwd: string; encoding: 'utf8' },
  ) => string = execFileSync,
): string {
  const trimmedOverride = override?.trim()
  if (trimmedOverride) {
    if (requireResolved && !/^[0-9a-f]{7,64}$/i.test(trimmedOverride)) {
      throw new Error('Remote sync --git-sha must be a Git SHA')
    }
    return trimmedOverride
  }

  try {
    const resolved = execGit('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    if (resolved) {
      if (requireResolved && !/^[0-9a-f]{7,64}$/i.test(resolved)) {
        throw new Error('Resolved git SHA is not valid for remote sync')
      }
      return resolved
    }
  } catch {
    if (!requireResolved) return 'unknown'
  }

  if (requireResolved) {
    throw new Error(
      'Unable to resolve git SHA for remote sync; run from a Git checkout or pass --git-sha',
    )
  }

  return 'unknown'
}

function wranglerBin(): string {
  return join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
}

export const syncCommand = new Command('sync')
  .description('Upsert the compiled sequences bundle into D1 (seq_sequences table)')
  .option('--remote', 'Apply to production D1 (default is local)')
  .option('--database <name>', 'D1 database name', 'sequencer-db')
  .option('--env <name>', 'Wrangler environment to use with remote D1 commands')
  .option('--git-sha <sha>', 'Override the git SHA recorded with each row')
  .action((opts) => {
    const root = resolve(process.cwd())
    const bundlePath = join(root, 'dist/sequences.json')

    if (!existsSync(bundlePath)) {
      console.error(chalk.red('No compiled bundle. Run: pnpm seq compile'))
      process.exit(1)
    }

    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as Bundle

    let statements: string[]
    try {
      const gitSha = resolveGitSha(root, opts.gitSha as string | undefined, Boolean(opts.remote))
      statements = buildSyncStatements(bundle, gitSha)
    } catch (error) {
      console.error(chalk.red((error as Error).message))
      process.exit(1)
    }

    const tmpDir = join(root, 'dist')
    mkdirSync(tmpDir, { recursive: true })
    const sqlFile = join(tmpDir, 'sequences-sync.sql')
    writeFileSync(sqlFile, statements.join('\n'))

    const target = opts.remote ? '--remote' : '--local'
    const args = wranglerD1ExecuteArgs(
      opts.database,
      target,
      sqlFile,
      opts.remote ? opts.env : undefined,
    )
    console.log(chalk.gray(`> wrangler ${args.join(' ')}`))

    try {
      execFileSync(process.execPath, [wranglerBin(), ...args], { stdio: 'inherit', cwd: root })
      console.log(chalk.green(`\nSynced ${bundle.sequences.length} sequences to D1 (${target})`))
    } catch (error) {
      console.error(chalk.red(`\nSync failed: ${(error as Error).message}`))
      process.exit(1)
    }
  })
