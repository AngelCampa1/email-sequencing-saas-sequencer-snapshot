import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { type SequenceDefinition, SequenceDefinitionSchema } from '@sequencer/shared'
import chalk from 'chalk'
import { Command } from 'commander'
import { glob } from 'glob'
import { parseSequenceFile, readSequenceSlugFromText } from '../lib/parser.js'
import { parseWranglerJsonOutput } from '../lib/readiness.js'
import { assertValidD1DatabaseName } from './readiness.js'

const require = createRequire(import.meta.url)

const RETIRED_REMOTE_PRODUCT_SLUGS = new Set([
  'gathergrove',
  'geoleap',
  'skillledger',
  'kaiplan',
  'pebbledesk',
  'boardstack',
  'phiguard',
  'grantpipe',
])

interface RemoteSequenceRow {
  slug: string
  product: string
  version: number
  definition: string
  compiled_at?: string | null
  compiled_from_sha?: string | null
}

export interface SequenceDiff {
  slug: string
  status: 'new' | 'changed' | 'deleted'
  product?: string
  version?: { remote: number; local: number }
  steps?: { remote: number; local: number }
  compiledAt?: string | null
  compiledFromSha?: string | null
}

interface SequenceDiffExitOptions {
  allowRetiredDeletions?: boolean
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function assertValidSequenceSlug(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid sequence slug: ${value}`)
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortForCompare(value))
}

function sortForCompare(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(sortForCompare)
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForCompare(child)]),
  )
}

export async function loadWorkingSequences(
  root: string,
  slug?: string,
): Promise<Map<string, SequenceDefinition>> {
  const pattern = join(root, 'sequences/**/*.yaml').replace(/\\/g, '/')
  const files = await glob(pattern)
  const sequences = new Map<string, SequenceDefinition>()

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const rawSlug = readSequenceSlugFromText(raw)
    if (slug && rawSlug !== slug) continue
    const result = parseSequenceFile(file)
    if (!result.ok) {
      throw new Error(`Invalid sequence file ${relative(root, file)}: ${result.errors.join('; ')}`)
    }
    sequences.set(result.definition.slug, result.definition)
  }

  return sequences
}

export function parseRemoteSequences(rows: RemoteSequenceRow[]): Map<string, SequenceDefinition> {
  const sequences = new Map<string, SequenceDefinition>()

  for (const row of rows) {
    const parsed = JSON.parse(row.definition) as unknown
    const result = SequenceDefinitionSchema.safeParse(parsed)
    if (!result.success) {
      if (RETIRED_REMOTE_PRODUCT_SLUGS.has(row.product)) {
        const raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
        sequences.set(row.slug, {
          ...raw,
          slug: typeof raw.slug === 'string' ? raw.slug : row.slug,
          product: row.product,
          version: typeof raw.version === 'number' ? raw.version : row.version,
          steps: Array.isArray(raw.steps) ? raw.steps : [],
        } as unknown as SequenceDefinition)
        continue
      }
      throw new Error(
        `Invalid D1 sequence definition ${row.slug}: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
      )
    }
    sequences.set(row.slug, result.data)
  }

  return sequences
}

export function buildSequenceDiffs(
  local: Map<string, SequenceDefinition>,
  remote: Map<string, SequenceDefinition>,
  remoteRows: Map<string, RemoteSequenceRow> = new Map(),
): SequenceDiff[] {
  const slugs = new Set([...local.keys(), ...remote.keys()])
  const diffs: SequenceDiff[] = []

  for (const slug of [...slugs].sort()) {
    const localDefinition = local.get(slug)
    const remoteDefinition = remote.get(slug)
    const row = remoteRows.get(slug)

    if (localDefinition && !remoteDefinition) {
      diffs.push({
        slug,
        status: 'new',
        product: localDefinition.product,
      })
      continue
    }

    if (!localDefinition && remoteDefinition) {
      diffs.push({
        slug,
        status: 'deleted',
        product: remoteDefinition.product,
        compiledAt: row?.compiled_at ?? null,
        compiledFromSha: row?.compiled_from_sha ?? null,
      })
      continue
    }

    if (!localDefinition || !remoteDefinition) continue
    if (stableJson(localDefinition) === stableJson(remoteDefinition)) continue

    diffs.push({
      slug,
      status: 'changed',
      product: localDefinition.product,
      version: { remote: remoteDefinition.version, local: localDefinition.version },
      steps: { remote: remoteDefinition.steps.length, local: localDefinition.steps.length },
      compiledAt: row?.compiled_at ?? null,
      compiledFromSha: row?.compiled_from_sha ?? null,
    })
  }

  return diffs
}

function isRetiredRemoteDeletion(diff: SequenceDiff): boolean {
  return (
    diff.status === 'deleted' &&
    Boolean(diff.product && RETIRED_REMOTE_PRODUCT_SLUGS.has(diff.product))
  )
}

export function sequenceDiffExitCode(
  diffs: SequenceDiff[],
  options: SequenceDiffExitOptions = {},
): 0 | 1 {
  const blockingDiffs = options.allowRetiredDeletions
    ? diffs.filter((diff) => !isRetiredRemoteDeletion(diff))
    : diffs
  return blockingDiffs.length === 0 ? 0 : 1
}

export function sequenceDeletionExitCode(
  diffs: SequenceDiff[],
  options: SequenceDiffExitOptions = {},
): 0 | 1 {
  return diffs.some(
    (diff) =>
      diff.status === 'deleted' &&
      !(options.allowRetiredDeletions && isRetiredRemoteDeletion(diff)),
  )
    ? 1
    : 0
}

function loadRemoteRows(
  root: string,
  database: string,
  remote: boolean,
  slug?: string,
  env?: string,
): RemoteSequenceRow[] {
  const target = remote ? '--remote' : '--local'
  const slugClause = slug ? ` AND s.slug = ${sqlString(slug)}` : ''
  const sql = `SELECT s.slug, p.slug AS product, s.version, s.definition, s.compiled_at, s.compiled_from_sha FROM seq_sequences s JOIN seq_products p ON p.id = s.product_id WHERE s.is_active = 1${slugClause} ORDER BY s.slug;`
  const wranglerBin = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
  const args = [wranglerBin, 'd1', 'execute', database, target]
  if (remote && env) args.push('--env', env)
  args.push('--config', 'apps/api/wrangler.toml', '--json', '--command', sql)
  const output = execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseWranglerJsonOutput<RemoteSequenceRow>(output)
}

function printDiff(diff: SequenceDiff): void {
  if (diff.status === 'new') {
    console.log(chalk.green(`+ NEW: ${diff.slug}`) + chalk.gray(` (${diff.product})`))
    return
  }

  if (diff.status === 'deleted') {
    console.log(
      chalk.red(`- DELETED FROM WORKTREE: ${diff.slug}`) + chalk.gray(` (${diff.product})`),
    )
    if (diff.compiledFromSha) console.log(chalk.gray(`  D1 sha: ${diff.compiledFromSha}`))
    return
  }

  console.log(chalk.yellow(`~ CHANGED: ${diff.slug}`) + chalk.gray(` (${diff.product})`))
  if (diff.version)
    console.log(chalk.gray(`  version: ${diff.version.remote} -> ${diff.version.local}`))
  if (diff.steps) console.log(chalk.gray(`  steps: ${diff.steps.remote} -> ${diff.steps.local}`))
  if (diff.compiledFromSha) console.log(chalk.gray(`  D1 sha: ${diff.compiledFromSha}`))
}

export const diffCommand = new Command('diff')
  .description('Show diff between working-tree sequences and active D1 sequence definitions')
  .argument('[slug]', 'Optional: diff a specific sequence slug')
  .option('--local', 'Compare against local D1 instead of production D1')
  .option('--check', 'Exit non-zero when any sequence diff is detected')
  .option(
    '--allow-retired-deletions',
    'Do not fail checks for active remote rows owned by products removed from the worktree',
  )
  .option(
    '--check-deletions',
    'Exit non-zero only when active D1 sequences are missing from the worktree',
  )
  .option('--database <name>', 'D1 database name', 'sequencer-db')
  .option('--env <name>', 'Wrangler environment to use with remote D1 commands')
  .action(
    async (
      slug?: string,
      opts?: {
        check?: boolean
        checkDeletions?: boolean
        local?: boolean
        database?: string
        env?: string
        allowRetiredDeletions?: boolean
      },
    ) => {
      const root = resolve(process.cwd())
      const database = assertValidD1DatabaseName(opts?.database ?? 'sequencer-db')
      const requestedSlug = slug ? assertValidSequenceSlug(slug) : undefined
      const useRemote = opts?.local !== true
      const localSequences = await loadWorkingSequences(root, requestedSlug)
      const remoteRows = loadRemoteRows(
        root,
        database,
        useRemote,
        requestedSlug,
        useRemote ? opts?.env : undefined,
      )
      const remoteRowMap = new Map(remoteRows.map((row) => [row.slug, row]))
      const remoteSequences = parseRemoteSequences(remoteRows)
      const diffs = buildSequenceDiffs(localSequences, remoteSequences, remoteRowMap)
      const target = useRemote ? 'production D1' : 'local D1'

      if (requestedSlug && localSequences.size === 0 && remoteSequences.size === 0) {
        console.error(
          chalk.red(`Sequence "${requestedSlug}" not found in working tree or ${target}.`),
        )
        process.exit(1)
      }

      if (diffs.length === 0) {
        console.log(chalk.gray(`No changes detected against ${target}.`))
        return
      }

      for (const diff of diffs) printDiff(diff)
      console.log(chalk.bold(`\n${diffs.length} sequence(s) changed against ${target}.`))
      if (opts?.checkDeletions) {
        process.exitCode = sequenceDeletionExitCode(diffs, {
          allowRetiredDeletions: opts?.allowRetiredDeletions,
        })
      } else if (opts?.check) {
        process.exitCode = sequenceDiffExitCode(diffs, {
          allowRetiredDeletions: opts?.allowRetiredDeletions,
        })
      }
    },
  )
