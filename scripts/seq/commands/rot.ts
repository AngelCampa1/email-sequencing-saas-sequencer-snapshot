import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { parseWranglerJsonOutput } from '../lib/readiness.js'
import { assertValidD1DatabaseName } from './readiness.js'

const require = createRequire(import.meta.url)

export interface RotRow {
  slug: string
  product: string
  active: number
  recent_enrollments: number
  total_enrollments: number
  last_enrolled_at: string | null
}

export interface RotCandidate {
  slug: string
  product: string
  recentEnrollments: number
  totalEnrollments: number
  lastEnrolledAt: string | null
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseRotRows(rows: Array<Record<string, unknown>>): RotRow[] {
  return rows.map((row) => ({
    slug: String(row.slug),
    product: String(row.product),
    active: toNumber(row.active),
    recent_enrollments: toNumber(row.recent_enrollments),
    total_enrollments: toNumber(row.total_enrollments),
    last_enrolled_at: typeof row.last_enrolled_at === 'string' ? row.last_enrolled_at : null,
  }))
}

export function buildRotReport(rows: RotRow[]): RotCandidate[] {
  return rows
    .filter((row) => row.active === 1 && row.recent_enrollments === 0)
    .map((row) => ({
      slug: row.slug,
      product: row.product,
      recentEnrollments: row.recent_enrollments,
      totalEnrollments: row.total_enrollments,
      lastEnrolledAt: row.last_enrolled_at,
    }))
}

function assertValidDays(value: string): number {
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error(`Invalid day window: ${value}`)
  }
  return days
}

function cutoffIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

export function buildRotSql(cutoff: string): string {
  return `
SELECT
  s.slug,
  p.slug AS product,
  s.is_active AS active,
  COALESCE(SUM(CASE WHEN r.started_at >= ${sqlString(cutoff)} THEN 1 ELSE 0 END), 0) AS recent_enrollments,
  COUNT(r.id) AS total_enrollments,
  MAX(r.started_at) AS last_enrolled_at
FROM seq_sequences s
JOIN seq_products p ON p.id = s.product_id
LEFT JOIN seq_sequence_runs r
  ON r.product_id = s.product_id
  AND r.sequence_slug = s.slug
WHERE s.is_active = 1
GROUP BY s.slug, p.slug, s.is_active
ORDER BY recent_enrollments ASC, last_enrolled_at ASC, s.slug ASC;
`.trim()
}

function queryRows(root: string, database: string, remote: boolean, days: number): RotRow[] {
  const target = remote ? '--remote' : '--local'
  const sql = buildRotSql(cutoffIso(days))
  const wranglerBin = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
  const output = execFileSync(
    process.execPath,
    [
      wranglerBin,
      'd1',
      'execute',
      database,
      target,
      '--config',
      'apps/api/wrangler.toml',
      '--json',
      '--command',
      sql,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  return parseRotRows(parseWranglerJsonOutput<Record<string, unknown>>(output))
}

function printReport(candidates: RotCandidate[], target: string, days: number): void {
  if (candidates.length === 0) {
    console.log(
      chalk.green(`No active sequences without enrollments in the last ${days} days on ${target}.`),
    )
    return
  }

  console.log(
    chalk.bold(`\nActive sequences with no enrollments in the last ${days} days on ${target}:`),
  )
  for (const candidate of candidates) {
    const last = candidate.lastEnrolledAt ?? 'never'
    console.log(
      chalk.cyan(`  ${candidate.slug}`) +
        chalk.gray(
          ` (${candidate.product}, total enrollments: ${candidate.totalEnrollments}, last: ${last})`,
        ),
    )
  }
  console.log(chalk.yellow(`\n${candidates.length} sequence(s) need review.`))
}

export const rotCommand = new Command('rot')
  .description('List active sequences with no enrollments in the configured window')
  .option('--local', 'Check local D1 instead of production D1')
  .option('--database <name>', 'D1 database name', 'sequencer-db')
  .option('--days <days>', 'Inactivity window in days', '90')
  .action((opts?: { local?: boolean; database?: string; days?: string }) => {
    const root = resolve(process.cwd())
    const database = assertValidD1DatabaseName(opts?.database ?? 'sequencer-db')
    const days = assertValidDays(opts?.days ?? '90')
    const useRemote = opts?.local !== true
    const rows = queryRows(root, database, useRemote, days)
    const target = useRemote ? 'production D1' : 'local D1'

    printReport(buildRotReport(rows), target, days)
  })
