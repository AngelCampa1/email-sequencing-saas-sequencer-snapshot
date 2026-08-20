import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import chalk from 'chalk'
import { Command } from 'commander'
import {
  buildReadinessReport,
  type LeadMagnetReadinessRow,
  parseWranglerJsonOutput,
  parseWranglerSecretListOutput,
  REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS,
} from '../lib/readiness.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const R2_ASSET_PROBE_CONCURRENCY = 6

type AsyncCommandExecutor = (args: string[], cwd: string) => Promise<{ stdout: string } | string>

interface AsyncRunOptions {
  maxAttempts?: number
  execute?: AsyncCommandExecutor
  sleep?: (ms: number) => Promise<void>
}

interface RemoteAssetProbeOptions {
  assets?: Array<{ bucket: string; key: string }>
  runCommand?: (args: string[], cwd: string) => Promise<string>
}

interface RemoteAssetProbeResult {
  present: Set<string>
  failures: Map<string, string>
}

function wranglerBin(): string {
  return join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
}

export function wranglerWhoamiArgs(): string[] {
  return ['whoami']
}

export function wranglerSecretListArgs(): string[] {
  return ['secret', 'list', '--env', 'production']
}

export function wranglerD1ExecuteArgs(
  database: string,
  target: '--local' | '--remote',
  sql: string,
  env?: string,
): string[] {
  const args = ['d1', 'execute', assertValidD1DatabaseName(database), target]
  if (env) args.push('--env', env)
  args.push('--json', '--command', sql)
  return args
}

export function wranglerD1MigrationsListArgs(
  database: string,
  target: '--local' | '--remote',
  env?: string,
): string[] {
  const args = ['d1', 'migrations', 'list', assertValidD1DatabaseName(database), target]
  if (env) args.push('--env', env)
  return args
}

export function wranglerR2ObjectGetArgs(bucket: string, key: string, file: string): string[] {
  return ['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', file]
}

function runWrangler(args: string[], cwd: string): string {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return execFileSync(process.execPath, [wranglerBin(), ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts || !isRetryableWranglerError(error)) break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }

  throw lastError
}

export async function runAsync(
  args: string[],
  cwd: string,
  options: AsyncRunOptions = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 5
  const execute =
    options.execute ??
    (async (commandArgs: string[], workingDirectory: string) =>
      execFileAsync(process.execPath, [wranglerBin(), ...commandArgs], {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
      }))
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await execute(args, cwd)
      return typeof result === 'string' ? result : result.stdout
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts || !isRetryableWranglerError(error)) break
      await sleep(500 * attempt)
    }
  }

  throw lastError
}

export function isRetryableWranglerError(error: unknown): boolean {
  const output =
    error && typeof error === 'object'
      ? `${'stdout' in error ? String(error.stdout) : ''}\n${'stderr' in error ? String(error.stderr) : ''}`
      : ''
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''

  return (
    output.includes('Authentication error [code: 10000]') ||
    output.includes('A request to the Cloudflare API') ||
    output.includes("The request to Cloudflare's API timed out") ||
    output.includes('fetch failed') ||
    code === '4294967295'
  )
}

export async function probeRemoteLeadMagnetAssetReadiness(
  apiDir: string,
  options: RemoteAssetProbeOptions = {},
): Promise<RemoteAssetProbeResult> {
  const assets = options.assets ?? requiredRemoteLeadMagnetAssetKeys()
  const runCommand = options.runCommand ?? runAsync
  const present = new Set<string>()
  const failures = new Map<string, string>()
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < assets.length) {
      const asset = assets[nextIndex]
      nextIndex += 1
      if (!asset) continue

      const tempDir = mkdtempSync(join(tmpdir(), 'seq-readiness-'))
      const tempFile = join(tempDir, 'asset')
      const assetKey = `${asset.bucket}/${asset.key}`
      try {
        await runCommand(wranglerR2ObjectGetArgs(asset.bucket, asset.key, tempFile), apiDir)
        present.add(assetKey)
      } catch (error) {
        if (!isMissingR2ObjectError(error)) {
          failures.set(assetKey, formatCommandError(error))
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(R2_ASSET_PROBE_CONCURRENCY, assets.length) }, () => worker()),
  )
  return { present, failures }
}

export async function probeRemoteLeadMagnetAssets(
  apiDir: string,
  options: RemoteAssetProbeOptions = {},
): Promise<Set<string>> {
  return (await probeRemoteLeadMagnetAssetReadiness(apiDir, options)).present
}

function formatCommandError(error: unknown): string {
  if (error && typeof error === 'object') {
    const output = [
      'stderr' in error ? String(error.stderr).trim() : '',
      'stdout' in error ? String(error.stdout).trim() : '',
      'message' in error ? String(error.message).trim() : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (output) return output.replace(/\s+/g, ' ').slice(0, 240)
  }
  return String(error ?? 'unknown error')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

export function assertValidD1DatabaseName(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid D1 database name: ${value}`)
  }
  return value
}

export function isMissingR2ObjectError(error: unknown): boolean {
  const output =
    error && typeof error === 'object'
      ? `${'stdout' in error ? String(error.stdout) : ''}\n${'stderr' in error ? String(error.stderr) : ''}`
      : String(error ?? '')
  return /object not found|NoSuchKey|key does not exist|404/i.test(output)
}

export function pendingD1MigrationsFromRows(
  rows: Array<{
    name?: string
    migration_name?: string
    applied?: boolean
    applied_at?: string | null
  }>,
): string[] {
  return rows
    .filter((row) => row.applied === false || (row.applied !== true && !row.applied_at))
    .map((row) => row.name ?? row.migration_name ?? '')
    .filter(Boolean)
}

export function pendingD1MigrationsFromText(output: string): string[] {
  if (/no migrations to apply/i.test(output)) return []

  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    for (const match of line.matchAll(/\b(\d{4}_[A-Za-z0-9_ -]+?)\b/g)) {
      names.add(match[1].trim())
    }
  }
  return [...names].sort()
}

function toCountMap(rows: Array<{ slug: string; count: number }>): Map<string, number> {
  return new Map(rows.map((row) => [row.slug, Number(row.count)]))
}

function toSequenceSlugMap(
  rows: Array<{ product_slug: string; sequence_slug: string }>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const row of rows) {
    const slugs = result.get(row.product_slug) ?? new Set<string>()
    slugs.add(row.sequence_slug)
    result.set(row.product_slug, slugs)
  }
  return result
}

function toStringListMap(
  rows: Array<{ slug: string; service_token_ids?: string | null }>,
): Map<string, string[]> {
  return new Map(
    rows.map((row) => [row.slug, (row.service_token_ids ?? '').split('\n').filter(Boolean)]),
  )
}

function toLeadMagnetRowsMap(
  rows: Array<{
    product_slug: string
    product_id: string
    id: string
    slug: string
    name: string
    asset_r2_bucket: string | null
    asset_r2_key: string | null
    fulfillment_sequence_slug: string | null
    conversion_event_name: string | null
    active: number | boolean
    active_rows: number
  }>,
): Map<string, LeadMagnetReadinessRow> {
  return new Map(
    rows.map((row) => [
      `${row.product_slug}/${row.slug}`,
      {
        productSlug: row.product_slug,
        productId: row.product_id,
        id: row.id,
        slug: row.slug,
        name: row.name,
        assetR2Bucket: row.asset_r2_bucket,
        assetR2Key: row.asset_r2_key,
        fulfillmentSequenceSlug: row.fulfillment_sequence_slug,
        conversionEventName: row.conversion_event_name,
        active: Boolean(row.active),
        activeRows: Number(row.active_rows),
      },
    ]),
  )
}

export function requiredRemoteLeadMagnetAssetKeys(): Array<{ bucket: string; key: string }> {
  return REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.map((leadMagnet) => {
    if (!leadMagnet.assetR2Bucket || !leadMagnet.assetR2Key) {
      throw new Error(
        `Lead magnet is missing a product asset location: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
      )
    }
    return { bucket: leadMagnet.assetR2Bucket, key: leadMagnet.assetR2Key }
  })
}

export const readinessCommand = new Command('readiness')
  .description('Check production readiness for live products')
  .option('--remote', 'Check remote D1 and production Worker secrets')
  .option(
    '--pre-sync',
    'Skip sequence convergence checks that are expected to change during seq sync',
  )
  .option('--database <name>', 'D1 database name', 'sequencer-db')
  .option('--env <name>', 'Wrangler environment to use with remote D1 commands')
  .option('--json', 'Print JSON report')
  .option('--out <path>', 'Write JSON report to a file')
  .action(async (opts) => {
    const root = process.cwd()
    const apiDir = `${root}/apps/api`
    const target = opts.remote ? '--remote' : '--local'
    const database = assertValidD1DatabaseName(opts.database)
    const wranglerEnv = opts.remote ? (opts.env as string | undefined) : undefined

    if (opts.remote) {
      runWrangler(wranglerWhoamiArgs(), apiDir)
    }

    const secretRows = opts.remote
      ? parseWranglerSecretListOutput(runWrangler(wranglerSecretListArgs(), apiDir))
      : []
    const secretNames = new Set(secretRows.map((row) => row.name))

    const productRows = parseWranglerJsonOutput<{ slug: string }>(
      runWrangler(
        wranglerD1ExecuteArgs(
          database,
          target,
          'SELECT slug FROM seq_products ORDER BY slug;',
          wranglerEnv,
        ),
        apiDir,
      ),
    )
    const sequenceRows = parseWranglerJsonOutput<{ slug: string; count: number }>(
      runWrangler(
        wranglerD1ExecuteArgs(
          database,
          target,
          'SELECT p.slug, COUNT(s.slug) AS count FROM seq_products p LEFT JOIN seq_sequences s ON s.product_id = p.id AND s.is_active = 1 GROUP BY p.slug;',
          wranglerEnv,
        ),
        apiDir,
      ),
    )
    const sequenceSlugRows = parseWranglerJsonOutput<{
      product_slug: string
      sequence_slug: string
    }>(
      runWrangler(
        wranglerD1ExecuteArgs(
          database,
          target,
          'SELECT p.slug AS product_slug, s.slug AS sequence_slug FROM seq_products p JOIN seq_sequences s ON s.product_id = p.id AND s.is_active = 1;',
          wranglerEnv,
        ),
        apiDir,
      ),
    )
    const tokenRows = parseWranglerJsonOutput<{
      slug: string
      count: number
      service_token_ids?: string | null
    }>(
      runWrangler(
        wranglerD1ExecuteArgs(
          database,
          target,
          'SELECT p.slug, COUNT(t.id) AS count, GROUP_CONCAT(t.access_service_token_id, char(10)) AS service_token_ids FROM seq_products p LEFT JOIN seq_api_tokens t ON t.product_id = p.id AND t.revoked_at IS NULL GROUP BY p.slug;',
          wranglerEnv,
        ),
        apiDir,
      ),
    )
    const retiredRows = parseWranglerJsonOutput<{ count: number }>(
      runWrangler(
        wranglerD1ExecuteArgs(
          database,
          target,
          "SELECT COUNT(*) AS count FROM seq_sequences WHERE product_id IN ('prod_reachally', 'prod_a11yproof', 'prod_grantpipe');",
          wranglerEnv,
        ),
        apiDir,
      ),
    )
    const pendingD1Migrations = opts.remote
      ? pendingD1MigrationsFromText(
          runWrangler(wranglerD1MigrationsListArgs(database, target, wranglerEnv), apiDir),
        )
      : []
    const leadMagnetRows = parseWranglerJsonOutput<{
      product_slug: string
      product_id: string
      id: string
      slug: string
      name: string
      asset_r2_bucket: string | null
      asset_r2_key: string | null
      fulfillment_sequence_slug: string | null
      conversion_event_name: string | null
      active: number | boolean
      active_rows: number
    }>(
      runWrangler(
        wranglerD1ExecuteArgs(
          database,
          target,
          'SELECT p.slug AS product_slug, l.product_id, l.id, l.slug, l.name, l.asset_r2_bucket, l.asset_r2_key, l.fulfillment_sequence_slug, l.conversion_event_name, l.active, COUNT(*) OVER (PARTITION BY p.slug, l.slug) AS active_rows FROM seq_lead_magnets l JOIN seq_products p ON p.id = l.product_id WHERE l.active = 1;',
          wranglerEnv,
        ),
        apiDir,
      ),
    )
    const leadMagnetAssetProbe = opts.remote
      ? await probeRemoteLeadMagnetAssetReadiness(apiDir)
      : undefined

    const report = buildReadinessReport({
      secretNames,
      productRows: new Set(productRows.map((row) => row.slug)),
      sequenceCounts: toCountMap(sequenceRows),
      sequenceSlugs: toSequenceSlugMap(sequenceSlugRows),
      tokenCounts: toCountMap(tokenRows),
      tokenServiceIds: toStringListMap(tokenRows),
      leadMagnetRows: toLeadMagnetRowsMap(leadMagnetRows),
      leadMagnetAssetKeys: leadMagnetAssetProbe?.present,
      leadMagnetAssetProbeFailures: leadMagnetAssetProbe?.failures,
      retiredSequenceRows: Number(retiredRows[0]?.count ?? 0),
      pendingD1Migrations,
      skipSequenceConvergence: Boolean(opts.preSync),
    })

    if (opts.out) {
      const outPath = resolve(root, opts.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
      console.log(chalk.gray(`Wrote ${outPath}`))
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2))
    } else if (report.findings.length > 0) {
      console.log(chalk.red(`Readiness failed: ${report.findings.length} issue(s)`))
      for (const finding of report.findings) {
        console.log(chalk.red(`- ${finding}`))
      }
    } else {
      console.log(chalk.green('Readiness passed.'))
    }

    if (!report.ok) process.exit(1)
  })
