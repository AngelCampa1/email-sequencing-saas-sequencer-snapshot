import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SequenceDefinition } from '@sequencer/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS } from '../lib/readiness.js'

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => childProcess)

import { diffCommand } from '../commands/diff.js'
import { readinessCommand } from '../commands/readiness.js'

function wranglerJson(results: unknown[]): string {
  return JSON.stringify([{ results, success: true }])
}

function sequence(overrides: Partial<SequenceDefinition> = {}): SequenceDefinition {
  return {
    slug: 'remote-only',
    product: 'camaudit',
    version: 1,
    exit_conditions: [{ event: 'reply_received' }],
    enroll: { trigger: 'lead_magnet_downloaded', lead_magnet: 'tenant-checklist' },
    variants: [
      { id: 'control', weight: 50 },
      { id: 'shorter-subjects', weight: 50 },
    ],
    steps: [
      {
        id: 'deliver',
        delay: '0m',
        template: 'lead-magnets/tenant-checklist-delivery',
        subject: 'Your checklist',
      },
    ],
    ...overrides,
  }
}

describe('CLI command orchestration coverage', () => {
  beforeEach(() => {
    childProcess.execFileSync.mockReset()
    childProcess.execFileSync.mockReturnValue(wranglerJson([]))
    childProcess.execFile.mockReset()
    childProcess.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, stdout?: string) => void
      callback(null, '')
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('runs local readiness through report writing and the failing JSON path', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seq-readiness-command-'))
    const out = join(tempDir, 'report.json')
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`)
    }) as never)

    try {
      await expect(
        readinessCommand.parseAsync(
          ['node', 'readiness', '--json', '--out', out, '--database', 'sequencer-db'],
          { from: 'node' },
        ),
      ).rejects.toThrow('process.exit 1')
      expect(exit).toHaveBeenCalledWith(1)
      expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ ok: false })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('runs remote readiness probes and renders human-readable findings', async () => {
    const leadMagnet = REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS[0]!
    childProcess.execFileSync.mockImplementation((_file, args: string[]) => {
      if (args.includes('whoami')) return 'authenticated'
      if (args.includes('secret')) return '[]'
      if (args.includes('migrations')) return 'No migrations to apply'
      const sql = args.at(-1) ?? ''
      if (sql.includes('FROM seq_lead_magnets')) {
        return wranglerJson([
          {
            product_slug: leadMagnet.productSlug,
            product_id: leadMagnet.productId,
            id: leadMagnet.id,
            slug: leadMagnet.slug,
            name: leadMagnet.name,
            asset_r2_bucket: leadMagnet.assetR2Bucket,
            asset_r2_key: leadMagnet.assetR2Key,
            fulfillment_sequence_slug: leadMagnet.fulfillmentSequenceSlug,
            conversion_event_name: leadMagnet.conversionEventName,
            active: 1,
            active_rows: 1,
          },
        ])
      }
      return wranglerJson([])
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`)
    }) as never)

    await expect(
      readinessCommand.parseAsync(
        ['node', 'readiness', '--remote', '--pre-sync', '--env', 'production'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit 1')
    expect(exit).toHaveBeenCalledWith(1)
    expect(childProcess.execFile).toHaveBeenCalled()
  })

  it('runs diff command new, changed, deleted, and missing-sequence output paths', async () => {
    await diffCommand.parseAsync(['node', 'diff', '--local', '--check'], { from: 'node' })
    expect(process.exitCode).toBe(1)

    childProcess.execFileSync.mockReturnValueOnce(
      wranglerJson([
        {
          slug: 'remote-only',
          product: 'camaudit',
          version: 1,
          definition: JSON.stringify(sequence()),
          compiled_at: '2026-07-13T00:00:00.000Z',
          compiled_from_sha: 'remote-sha',
        },
      ]),
    )
    await diffCommand.parseAsync(['node', 'diff', 'remote-only', '--local'], { from: 'node' })

    const localSlug = 'floriva-web-nurture-value-1'
    childProcess.execFileSync.mockReturnValueOnce(
      wranglerJson([
        {
          slug: localSlug,
          product: 'floriva-web',
          version: 1,
          definition: JSON.stringify(
            sequence({
              slug: localSlug,
              product: 'floriva-web',
              steps: [
                {
                  id: 'deliver',
                  delay: '0m',
                  template: 'lead-magnets/tenant-checklist-delivery',
                  subject: 'An old subject',
                },
              ],
            }),
          ),
          compiled_from_sha: 'old-sha',
        },
      ]),
    )
    await diffCommand.parseAsync(['node', 'diff', localSlug, '--local'], { from: 'node' })

    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`)
    }) as never)
    await expect(
      diffCommand.parseAsync(['node', 'diff', 'not-present', '--local'], { from: 'node' }),
    ).rejects.toThrow('process.exit 1')
    expect(exit).toHaveBeenCalledWith(1)
  })
})
