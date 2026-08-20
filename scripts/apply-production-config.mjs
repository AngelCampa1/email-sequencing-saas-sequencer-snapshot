#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandInvocation, execFileOptions, output as execOutput, run as execRun } from './lib/process.mjs'
import { parseWranglerSecretListOutput } from './lib/wrangler-output.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = resolve(root, 'apps/api')
const dryRun = process.argv.includes('--dry-run')
const secretsFileArgIndex = process.argv.indexOf('--secrets-file')
if (secretsFileArgIndex >= 0 && !process.argv[secretsFileArgIndex + 1]) {
  throw new Error('--secrets-file requires a path')
}
const secretsPath = secretsFileArgIndex >= 0
  ? resolve(root, process.argv[secretsFileArgIndex + 1] ?? '')
  : resolve(root, 'dist/production-secrets.template.json')
const accessTokensPath = resolve(root, 'dist/access-service-tokens.template.json')
const tokenSqlPath = resolve(root, 'dist/product-api-tokens.sql')

function run(command, args, options = {}) {
  execRun(command, args, { cwd: options.cwd ?? root })
}

function output(command, args, options = {}) {
  return execOutput(command, args, { cwd: options.cwd ?? root })
}

let currentChild = null

function runInterruptible(command, args, options = {}) {
  const cwd = options.cwd ?? root
  console.log(`\n> ${[command, ...args].join(' ')}`)
  const invocation = commandInvocation(command, args)
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(invocation.file, invocation.args, execFileOptions(cwd, options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit'))
    currentChild = child
    if (options.input) {
      child.stdin.end(options.input)
    }
    child.once('error', (error) => {
      if (currentChild === child) currentChild = null
      rejectRun(error)
    })
    child.once('exit', (code, signal) => {
      if (currentChild === child) currentChild = null
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(signal ? `${command} terminated by ${signal}` : `${command} exited with ${code ?? 1}`))
    })
  })
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

function isPlaceholder(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length === 0
    || (trimmed.startsWith('<') && trimmed.endsWith('>'))
    || /your_|example|placeholder|changeme|dummy|test/i.test(trimmed)
}

function validateSecretValue(key, value) {
  const trimmed = String(value ?? '').trim()
  if (isPlaceholder(trimmed)) return `Missing real production secret value for: ${key}`

  if (key.startsWith('RESEND_API_KEY_') && !/^re_[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    return `Invalid Resend API key format for: ${key}`
  }

  if (key === 'RESEND_WEBHOOK_SECRET') {
    if (!trimmed.startsWith('whsec_')) return `Invalid Resend webhook secret format for: ${key}`
    const encoded = trimmed.slice('whsec_'.length)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return `Invalid Resend webhook secret format for: ${key}`
    const decoded = Buffer.from(encoded, 'base64')
    if (decoded.length < 16) return `Invalid Resend webhook secret format for: ${key}`
  }

  if ((key === 'INSTANTLY_WEBHOOK_SECRET' || key === 'INSTANTLY_API_KEY' || key === 'UNSUBSCRIBE_SIGNING_SECRET')
    && trimmed.length < 20) {
    return `Production secret value is too short for: ${key}`
  }

  if (key === 'SENTRY_DSN' && !/^https:\/\/[^@]+@[^/]+\/\d+$/.test(trimmed)) {
    return `Invalid Sentry DSN format for: ${key}`
  }

  return null
}

function getPresentProductionSecrets() {
  const raw = output('pnpm', ['exec', 'wrangler', 'secret', 'list', '--env', 'production'], { cwd: apiDir })
  return new Set(parseWranglerSecretListOutput(raw).map((row) => row.name))
}

function validateSecrets() {
  const requiredTemplate = JSON.parse(output('pnpm', ['exec', 'tsx', 'scripts/seq/index.ts', 'secret-template']))
  const secrets = readJson(secretsPath)
  const requiredKeys = Object.keys(requiredTemplate)
  const presentSecrets = getPresentProductionSecrets()
  const missingKeys = []
  const placeholderKeys = []
  const unexpectedKeys = []
  const uploadSecrets = {}

  for (const key of requiredKeys) {
    if (!(key in secrets)) {
      if (!presentSecrets.has(key)) missingKeys.push(key)
      continue
    }

    if (presentSecrets.has(key) && isPlaceholder(secrets[key])) {
      continue
    }

    const secretError = validateSecretValue(key, secrets[key])
    if (secretError) placeholderKeys.push(secretError)
    else uploadSecrets[key] = secrets[key]
  }

  for (const key of Object.keys(secrets)) {
    if (!requiredKeys.includes(key)) unexpectedKeys.push(key)
  }

  const errors = [
    ...missingKeys.map((key) => `Missing production secret key in ${secretsPath}: ${key}`),
    ...placeholderKeys,
    ...unexpectedKeys.map((key) => `Unexpected production secret key in ${secretsPath}: ${key}`),
  ]

  return { errors, uploadSecrets }
}

function validateAccessTokens() {
  const requiredTemplate = JSON.parse(output('pnpm', ['exec', 'tsx', 'scripts/seq/index.ts', 'access-token-template']))
  const accessTokens = readJson(accessTokensPath)
  const requiredProducts = Object.keys(requiredTemplate)
  const errors = []
  const productByServiceTokenId = new Map()

  for (const product of requiredProducts) {
    if (!(product in accessTokens)) {
      errors.push(`Missing Access service-token entry in ${accessTokensPath}: ${product}`)
      continue
    }

    const serviceTokenId = (
      accessTokens[product]?.access_client_id?.trim?.()
      ?? accessTokens[product]?.service_token_id?.trim?.()
      ?? ''
    )
    if (isPlaceholder(serviceTokenId)) {
      errors.push(`Missing real access_client_id for product: ${product}`)
      continue
    }

    const existingProduct = productByServiceTokenId.get(serviceTokenId)
    if (existingProduct) {
      errors.push(`Duplicate service_token_id for products: ${existingProduct}, ${product}`)
      continue
    }

    productByServiceTokenId.set(serviceTokenId, product)
  }

  for (const product of Object.keys(accessTokens)) {
    if (!requiredProducts.includes(product)) {
      errors.push(`Unexpected product in Access token template: ${product}`)
    }
  }

  return errors
}

function cleanupFilteredSecrets() {
  currentChild?.kill('SIGTERM')
  currentChild = null
}

process.once('SIGINT', () => {
  cleanupFilteredSecrets()
  process.exit(130)
})

process.once('SIGTERM', () => {
  cleanupFilteredSecrets()
  process.exit(143)
})

let exitCode = 0

try {
  const secretValidation = validateSecrets()
  const errors = [
    ...secretValidation.errors,
    ...validateAccessTokens(),
  ]

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  run('pnpm', ['seq', 'token-sql', '--access-token-file', accessTokensPath, '--out', tokenSqlPath])

  if (dryRun) {
    console.log('\nProduction config files validate. Dry run did not upload secrets or write D1.')
  } else {
    await runInterruptible('pnpm', ['exec', 'wrangler', 'secret', 'bulk', '--env', 'production'], {
      cwd: apiDir,
      input: `${JSON.stringify(secretValidation.uploadSecrets, null, 2)}\n`,
    })
    await runInterruptible('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'sequencer-db', '--remote', '--env', 'production', '--file', tokenSqlPath], { cwd: apiDir })
    await runInterruptible('pnpm', ['seq', 'readiness', '--remote', '--env', 'production'])
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  exitCode = 1
} finally {
  cleanupFilteredSecrets()
}

process.exit(exitCode)
