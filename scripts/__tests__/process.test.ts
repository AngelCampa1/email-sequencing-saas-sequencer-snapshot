import { describe, expect, it } from 'vitest'
import { commandInvocation, execFileOptions, formatCommandForLog } from '../lib/process.mjs'

describe('production script process helpers', () => {
  it('runs pnpm through its CJS entrypoint on Windows without enabling a shell', () => {
    expect(
      commandInvocation('pnpm', ['--version'], {
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' },
        fileExists: (path) =>
          path === 'C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs',
        nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      }),
    ).toEqual({
      file: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs',
        '--version',
      ],
    })
    expect(commandInvocation('git', ['rev-parse', 'HEAD'], { platform: 'win32' })).toEqual({
      file: 'git',
      args: ['rev-parse', 'HEAD'],
    })
    expect(commandInvocation('pnpm', ['--version'], { platform: 'linux' })).toEqual({
      file: 'pnpm',
      args: ['--version'],
    })
  })

  it('builds execFile options without shell execution', () => {
    expect(execFileOptions('C:\\repo', 'inherit')).toEqual({
      cwd: 'C:\\repo',
      stdio: 'inherit',
    })
    expect(execFileOptions('C:\\repo', 'pipe', 'utf8')).toEqual({
      cwd: 'C:\\repo',
      encoding: 'utf8',
      stdio: 'pipe',
    })
  })

  it('formats commands for logs without changing argv values', () => {
    expect(
      formatCommandForLog('pnpm', ['exec', 'wrangler', 'deploy', '--var', 'GIT_SHA:abc123']),
    ).toBe('pnpm exec wrangler deploy --var GIT_SHA:abc123')
  })
})
