import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dryRunCommand, loadDryRunSequence } from '../commands/dry-run.js'

describe('seq dry-run command', () => {
  const originalCwd = process.cwd()

  afterEach(() => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
  })

  it('ignores unrelated malformed YAML when previewing one requested sequence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seq-dry-run-test-'))
    try {
      const sequenceDir = join(root, 'sequences', 'camaudit')
      mkdirSync(sequenceDir, { recursive: true })
      writeFileSync(
        join(sequenceDir, 'aaa-unrelated-broken.yaml'),
        ['slug: unrelated-broken', 'product: camaudit', 'steps: [', ''].join('\n'),
      )
      writeFileSync(
        join(sequenceDir, 'requested.yaml'),
        [
          'slug: requested-sequence',
          'product: camaudit',
          'version: 1',
          'steps:',
          '  - id: deliver',
          '    delay: 0m',
          '    template: lead-magnets/tenant-checklist-delivery',
          '    subject: Your checklist',
          '',
        ].join('\n'),
      )
      process.chdir(root)
      vi.spyOn(console, 'log').mockImplementation(() => undefined)
      vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(
        loadDryRunSequence(root, 'requested-sequence', [
          join(sequenceDir, 'aaa-unrelated-broken.yaml'),
          join(sequenceDir, 'requested.yaml'),
        ]),
      ).resolves.toEqual(expect.objectContaining({ slug: 'requested-sequence' }))

      await expect(
        dryRunCommand.parseAsync(['node', 'dry-run', 'requested-sequence'], { from: 'node' }),
      ).resolves.toBeDefined()

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Dry run: requested-sequence'),
      )
      expect(console.error).not.toHaveBeenCalled()
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports validation errors for the requested sequence file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seq-dry-run-test-'))
    try {
      const sequenceDir = join(root, 'sequences', 'camaudit')
      const requested = join(sequenceDir, 'requested.yaml')
      mkdirSync(sequenceDir, { recursive: true })
      writeFileSync(
        requested,
        ['slug: requested-sequence', 'product: camaudit', 'version: 1', ''].join('\n'),
      )

      await expect(loadDryRunSequence(root, 'requested-sequence', [requested])).rejects.toThrow(
        /invalid sequence/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses compiler validation for the requested sequence file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seq-dry-run-test-'))
    try {
      const sequenceDir = join(root, 'sequences', 'camaudit')
      const requested = join(sequenceDir, 'requested.yaml')
      mkdirSync(sequenceDir, { recursive: true })
      writeFileSync(
        requested,
        [
          'slug: requested-sequence',
          'product: camaudit',
          'version: 1',
          'steps:',
          '  - id: deliver',
          '    delay: 0m',
          '    template: missing/template',
          '    subject: Your checklist',
          '',
        ].join('\n'),
      )

      await expect(loadDryRunSequence(root, 'requested-sequence', [requested])).rejects.toThrow(
        /unknown template slug/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports malformed YAML for the requested sequence file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seq-dry-run-test-'))
    try {
      const sequenceDir = join(root, 'sequences', 'camaudit')
      const requested = join(sequenceDir, 'requested.yaml')
      mkdirSync(sequenceDir, { recursive: true })
      writeFileSync(
        requested,
        ['slug: requested-sequence', 'product: camaudit', 'steps: [', ''].join('\n'),
      )

      await expect(loadDryRunSequence(root, 'requested-sequence', [requested])).rejects.toThrow(
        /invalid sequence/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
