#!/usr/bin/env node
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { output as execOutput, run as execRun } from './lib/process.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = resolve(root, 'apps/api')
const dryRun = process.argv.includes('--dry-run')
const migrate = process.argv.includes('--migrate')
const allowSequenceDeactivation = process.argv.includes('--allow-sequence-deactivation')

function run(command, args, options = {}) {
  execRun(command, args, { cwd: options.cwd ?? root })
}

function output(command, args, options = {}) {
  return execOutput(command, args, { cwd: options.cwd ?? root })
}

try {
  if (migrate) {
    console.error([
      'deploy:prod:migrate is disabled because applying production D1 migrations before a compatible Worker deploy can break live writes.',
      'Use the documented expand/deploy/contract migration strategy in docs/deploy.md instead.',
    ].join('\n'))
    process.exit(1)
  }

  run('pnpm', ['seq', 'compile'])

  run('pnpm', ['exec', 'wrangler', 'whoami'], { cwd: apiDir })

  if (dryRun) {
    console.log('\n> skipping remote sequence sync for dry run')
    run('pnpm', ['seq', 'diff', '--check', '--env', 'production'])
  } else {
    if (!allowSequenceDeactivation) {
      run('pnpm', ['seq', 'diff', '--check-deletions', '--env', 'production'])
    }
  }

  run('pnpm', ['build'])
  run('pnpm', ['test:system'])

  const gitSha = process.env.GIT_SHA?.trim() || output('git', ['rev-parse', 'HEAD'])
  const deployArgs = ['exec', 'wrangler', 'deploy', '--var', `GIT_SHA:${gitSha}`, '--env', 'production']
  if (dryRun) {
    run('pnpm', ['seq', 'readiness', '--remote', '--env', 'production'])
    deployArgs.push('--dry-run')
    run('pnpm', deployArgs, { cwd: apiDir })
  } else {
    run('pnpm', [...deployArgs, '--dry-run'], { cwd: apiDir })
    run('pnpm', ['seq', 'readiness', '--remote', '--pre-sync', '--env', 'production'])
    run('pnpm', deployArgs, { cwd: apiDir })
    run('pnpm', ['seq', 'sync', '--remote', '--env', 'production'])
    run('pnpm', ['seq', 'readiness', '--remote', '--env', 'production'])
  }
} catch (error) {
  if (typeof error === 'object' && error && 'status' in error) {
    process.exit(Number(error.status) || 1)
  }
  throw error
}
