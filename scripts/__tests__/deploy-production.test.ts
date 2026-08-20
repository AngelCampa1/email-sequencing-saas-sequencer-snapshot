import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const envBackup = {
  APPDATA: process.env.APPDATA,
  PNPM_HOME: process.env.PNPM_HOME,
  PATH: process.env.PATH,
  GIT_SHA: process.env.GIT_SHA,
}
const fakePnpmRoots: string[] = []

describe('production deploy script', () => {
  afterEach(() => {
    for (const path of fakePnpmRoots.splice(0)) {
      rmSync(path, { force: true, recursive: true })
    }
    process.env.APPDATA = envBackup.APPDATA
    process.env.PNPM_HOME = envBackup.PNPM_HOME
    process.env.PATH = envBackup.PATH
    process.env.GIT_SHA = envBackup.GIT_SHA
  })

  it('checks remote sequence convergence during dry runs before readiness', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const script = readFileSync(resolve(repoRoot, 'scripts/deploy-production.mjs'), 'utf8')

    const diffCheckIndex = script.indexOf(
      "run('pnpm', ['seq', 'diff', '--check', '--env', 'production'])",
    )
    const readinessIndex = script.indexOf(
      "run('pnpm', ['seq', 'readiness', '--remote', '--env', 'production'])",
    )

    expect(diffCheckIndex).toBeGreaterThan(-1)
    expect(readinessIndex).toBeGreaterThan(diffCheckIndex)
  })

  it('checks for remote sequence deletions before real remote sync', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const script = readFileSync(resolve(repoRoot, 'scripts/deploy-production.mjs'), 'utf8')

    const deletionCheckIndex = script.indexOf(
      "run('pnpm', ['seq', 'diff', '--check-deletions', '--env', 'production'])",
    )
    const syncIndex = script.indexOf(
      "run('pnpm', ['seq', 'sync', '--remote', '--env', 'production'])",
    )

    expect(deletionCheckIndex).toBeGreaterThan(-1)
    expect(syncIndex).toBeGreaterThan(deletionCheckIndex)
  })

  it('fails closed instead of applying production migrations before deploy', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const script = readFileSync(resolve(repoRoot, 'scripts/deploy-production.mjs'), 'utf8')

    const disabledMessageIndex = script.indexOf('deploy:prod:migrate is disabled')
    const migrationApplyIndex = script.indexOf(
      "run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'sequencer-db', '--remote']",
    )

    expect(disabledMessageIndex).toBeGreaterThan(-1)
    expect(migrationApplyIndex).toBe(-1)
  })

  it('deploys the compatible Worker before mutating remote sequence state', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const callsPath = installFakePnpm(repoRoot)

    const result = spawnSync(process.execPath, ['scripts/deploy-production.mjs'], {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    const calls = readFileSync(callsPath, 'utf8').trim().split(/\r?\n/)
    const buildIndex = calls.indexOf('build')
    const systemTestIndex = calls.indexOf('test:system')
    const deployDryRunIndex = calls.indexOf(
      'exec wrangler deploy --var GIT_SHA:test-sha --env production --dry-run',
    )
    const syncIndex = calls.indexOf('seq sync --remote --env production')
    const deployIndex = calls.indexOf(
      'exec wrangler deploy --var GIT_SHA:test-sha --env production',
    )

    expect(buildIndex).toBeGreaterThan(-1)
    expect(systemTestIndex).toBeGreaterThan(buildIndex)
    expect(deployDryRunIndex).toBeGreaterThan(systemTestIndex)
    expect(deployIndex).toBeGreaterThan(deployDryRunIndex)
    expect(syncIndex).toBeGreaterThan(deployIndex)
  })

  it('does not sync remote sequences when pre-sync readiness fails', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const callsPath = installFakePnpm(repoRoot, {
      fail: 'seq readiness --remote --pre-sync --env production',
    })

    const result = spawnSync(process.execPath, ['scripts/deploy-production.mjs'], {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    const calls = readFileSync(callsPath, 'utf8').trim().split(/\r?\n/)
    expect(calls).toContain('seq readiness --remote --pre-sync --env production')
    expect(calls).not.toContain('seq sync --remote --env production')
  })
})

function installFakePnpm(_repoRoot: string, options: { fail?: string } = {}): string {
  const appData = mkdtempSync(resolve(tmpdir(), 'sequencer-deploy-production-'))
  const pnpmBinDir = resolve(appData, 'npm/node_modules/pnpm/bin')
  const pathBinDir = resolve(appData, 'bin')
  const callsPath = resolve(appData, 'calls.log')
  const fakePnpm = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
const command = args.join(' ')
appendFileSync(${JSON.stringify(callsPath)}, command + '\\n')
if (command === ${JSON.stringify(options.fail ?? '')}) process.exit(1)
const ok = new Set([
  'seq compile',
  'exec wrangler whoami',
  'seq diff --check --env production',
  'seq diff --check-deletions --env production',
  'build',
  'test:system',
  'exec wrangler deploy --var GIT_SHA:test-sha --env production --dry-run',
  'seq readiness --remote --pre-sync --env production',
  'seq sync --remote --env production',
  'seq readiness --remote --env production',
  'exec wrangler deploy --var GIT_SHA:test-sha --env production',
])
if (ok.has(command)) process.exit(0)
console.error('unexpected pnpm args: ' + command)
process.exit(2)
`
  rmSync(callsPath, { force: true })
  mkdirSync(pnpmBinDir, { recursive: true })
  mkdirSync(pathBinDir, { recursive: true })
  writeFileSync(resolve(pnpmBinDir, 'pnpm.cjs'), fakePnpm)
  writeFileSync(resolve(pathBinDir, 'pnpm'), fakePnpm)
  chmodSync(resolve(pathBinDir, 'pnpm'), 0o755)
  fakePnpmRoots.push(appData)
  process.env.APPDATA = appData
  delete process.env.PNPM_HOME
  process.env.PATH = `${pathBinDir}${delimiter}${envBackup.PATH ?? ''}`
  process.env.GIT_SHA = 'test-sha'
  return callsPath
}
