import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

function pnpmCjsCandidates(env) {
  const candidates = []
  const windowsJoin = (...parts) => win32.join(...parts)
  if (env.APPDATA) {
    candidates.push(windowsJoin(env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
  }
  if (env.PNPM_HOME) {
    candidates.push(windowsJoin(env.PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
  }
  for (const entry of String(env.PATH ?? '').split(';').filter(Boolean)) {
    candidates.push(windowsJoin(entry, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
  }
  return candidates
}

export function commandInvocation(command, args, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32' && command === 'pnpm') {
    const env = options.env ?? process.env
    const fileExists = options.fileExists ?? existsSync
    const pnpmCjs = pnpmCjsCandidates(env).find((candidate) => fileExists(candidate))
    if (!pnpmCjs) {
      throw new Error('Unable to locate pnpm CJS entrypoint for shell-free Windows execution')
    }
    return {
      file: options.nodePath ?? process.execPath,
      args: [pnpmCjs, ...args],
    }
  }

  return { file: command, args }
}

export function execFileOptions(cwd, stdio, encoding) {
  return {
    cwd,
    ...(encoding ? { encoding } : {}),
    stdio,
  }
}

export function formatCommandForLog(command, args) {
  return [command, ...args].join(' ')
}

export function run(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  console.log(`\n> ${formatCommandForLog(command, args)}`)
  const invocation = commandInvocation(command, args)
  execFileSync(invocation.file, invocation.args, execFileOptions(cwd, 'inherit'))
}

export function output(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const invocation = commandInvocation(command, args)
  return execFileSync(invocation.file, invocation.args, execFileOptions(cwd, 'pipe', 'utf8')).trim()
}
