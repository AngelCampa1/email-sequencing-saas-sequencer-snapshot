import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const distDir = resolve(repoRoot, 'dist')
const testInputsDir = resolve(tmpdir(), `sequencer-apply-config-inputs-${process.pid}`)
const applySecretsPath = resolve(distDir, 'production-secrets.apply.json')
const uploadStartedPath = resolve(distDir, 'production-secrets-upload.started')
const productionSecretsPath = resolve(testInputsDir, 'production-secrets.template.json')
const accessTokensPath = resolve(distDir, 'access-service-tokens.template.json')
const tokenSqlPath = resolve(distDir, 'product-api-tokens.sql')
const validResendWebhookSecret = `whsec_${Buffer.from('prod-resend-webhook-secret').toString('base64')}`

const envBackup = {
  APPDATA: process.env.APPDATA,
  PNPM_HOME: process.env.PNPM_HOME,
  PATH: process.env.PATH,
}
const fakePnpmRoots: string[] = []

function removeTestFiles() {
  for (const path of [
    applySecretsPath,
    uploadStartedPath,
    productionSecretsPath,
    accessTokensPath,
    tokenSqlPath,
  ]) {
    rmSync(path, { force: true })
  }
}

function writeProductionInputs(overrides: Record<string, string> = {}) {
  mkdirSync(distDir, { recursive: true })
  mkdirSync(testInputsDir, { recursive: true })
  writeFileSync(
    productionSecretsPath,
    `${JSON.stringify(
      {
        RESEND_WEBHOOK_SECRET: validResendWebhookSecret,
        INSTANTLY_WEBHOOK_SECRET: 'prod_instantly_webhook_secret_123',
        ...overrides,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    accessTokensPath,
    `${JSON.stringify(
      {
        camaudit: { access_client_id: 'camaudit.access' },
      },
      null,
      2,
    )}\n`,
  )
}

function installFakePnpm(options: { failD1?: boolean; hangBulk?: boolean } = {}) {
  const appData = resolve(
    tmpdir(),
    `sequencer-apply-config-${process.pid}-${Math.random().toString(36).slice(2)}`,
  )
  const pnpmBinDir = resolve(appData, 'npm/node_modules/pnpm/bin')
  const pathBinDir = resolve(appData, 'bin')
  mkdirSync(pnpmBinDir, { recursive: true })
  mkdirSync(pathBinDir, { recursive: true })
  const fakePnpm = `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const args = process.argv.slice(2)
const repoRoot = ${JSON.stringify(repoRoot)}

if (args.join(' ') === 'exec tsx scripts/seq/index.ts secret-template') {
  console.log(JSON.stringify({
    RESEND_WEBHOOK_SECRET: '<secret>',
    INSTANTLY_WEBHOOK_SECRET: '<secret>'
  }))
  process.exit(0)
}

if (args.join(' ') === 'exec wrangler secret list --env production') {
  console.log(JSON.stringify([]))
  process.exit(0)
}

if (args.join(' ') === 'exec tsx scripts/seq/index.ts access-token-template') {
  console.log(JSON.stringify({ camaudit: { access_client_id: '<access-client-id>' } }))
  process.exit(0)
}

if (args[0] === 'seq' && args[1] === 'token-sql') {
  writeFileSync(resolve(repoRoot, 'dist/product-api-tokens.sql'), '-- token sql\\n')
  process.exit(0)
}

if (args.join(' ') === 'exec wrangler secret bulk --env production') {
  if (existsSync(resolve(repoRoot, 'dist/production-secrets.apply.json'))) {
    console.error('bulk secrets file should not be written during upload')
    process.exit(1)
  }
  const secrets = JSON.parse(readFileSync(0, 'utf8'))
  if (secrets.RESEND_WEBHOOK_SECRET !== ${JSON.stringify(validResendWebhookSecret)}) {
    console.error('bulk secrets stdin was missing expected secrets')
    process.exit(1)
  }
  writeFileSync(resolve(repoRoot, 'dist/production-secrets-upload.started'), 'ok\\n')
  if (${options.hangBulk ? 'true' : 'false'}) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
  }
  process.exit(0)
}

if (args.join(' ') === 'exec wrangler d1 execute sequencer-db --remote --env production --file ' + resolve(repoRoot, 'dist/product-api-tokens.sql')) {
  if (${options.failD1 ? 'true' : 'false'}) {
    console.error('simulated d1 failure')
    process.exit(19)
  }
  process.exit(0)
}

if (args.join(' ') === 'seq readiness --remote --env production') {
  process.exit(0)
}

console.error('unexpected pnpm args: ' + args.join(' '))
process.exit(2)
`
  writeFileSync(resolve(pnpmBinDir, 'pnpm.cjs'), fakePnpm)
  writeFileSync(resolve(pathBinDir, 'pnpm'), fakePnpm)
  chmodSync(resolve(pathBinDir, 'pnpm'), 0o755)

  fakePnpmRoots.push(appData)
  process.env.APPDATA = appData
  delete process.env.PNPM_HOME
  process.env.PATH = `${pathBinDir}${delimiter}${envBackup.PATH ?? ''}`
}

function runApplyProductionConfig() {
  return spawnSync(
    process.execPath,
    ['scripts/apply-production-config.mjs', '--secrets-file', productionSecretsPath],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
    },
  )
}

function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  return new Promise((resolveWait, rejectWait) => {
    const timer = setInterval(() => {
      if (existsSync(path)) {
        clearInterval(timer)
        resolveWait()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(timer)
        rejectWait(new Error(`Timed out waiting for ${path}`))
      }
    }, 25)
  })
}

describe('apply production config script', () => {
  beforeEach(() => {
    removeTestFiles()
    writeProductionInputs()
  })

  afterEach(() => {
    removeTestFiles()
    rmSync(testInputsDir, { force: true, recursive: true })
    for (const path of fakePnpmRoots.splice(0)) {
      rmSync(path, { force: true, recursive: true })
    }
    process.env.APPDATA = envBackup.APPDATA
    process.env.PNPM_HOME = envBackup.PNPM_HOME
    process.env.PATH = envBackup.PATH
  })

  it('deletes the filtered production secrets file after a successful apply', () => {
    installFakePnpm()

    const result = runApplyProductionConfig()

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(existsSync(applySecretsPath)).toBe(false)
  })

  it('deletes the filtered production secrets file when a later apply step fails', () => {
    installFakePnpm({ failD1: true })

    const result = runApplyProductionConfig()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('simulated d1 failure')
    expect(existsSync(applySecretsPath)).toBe(false)
  })

  it('deletes the filtered production secrets file when interrupted during secret upload', async () => {
    installFakePnpm({ hangBulk: true })
    const child = spawn(
      process.execPath,
      ['scripts/apply-production-config.mjs', '--secrets-file', productionSecretsPath],
      {
        cwd: repoRoot,
        env: { ...process.env },
        stdio: 'ignore',
      },
    )

    await waitForFile(uploadStartedPath)
    child.kill('SIGINT')
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveExit) => {
        child.once('exit', (code, signal) => resolveExit({ code, signal }))
      },
    )

    expect(existsSync(applySecretsPath)).toBe(false)
  })

  it('rejects Resend webhook secrets that cannot verify Svix signatures at runtime', () => {
    writeProductionInputs({ RESEND_WEBHOOK_SECRET: 'prod_resend_webhook_secret_123' })
    installFakePnpm()

    const result = runApplyProductionConfig()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Invalid Resend webhook secret format for: RESEND_WEBHOOK_SECRET',
    )
    expect(existsSync(uploadStartedPath)).toBe(false)
  })
})
