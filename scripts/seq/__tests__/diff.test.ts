import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SequenceDefinition } from '@sequencer/shared'
import { describe, expect, it } from 'vitest'
import {
  assertValidSequenceSlug,
  buildSequenceDiffs,
  loadWorkingSequences,
  parseRemoteSequences,
  sequenceDeletionExitCode,
  sequenceDiffExitCode,
} from '../commands/diff.js'

function sequence(overrides: Partial<SequenceDefinition> = {}): SequenceDefinition {
  return {
    slug: 'camaudit-lead-magnet-tenant-checklist',
    product: 'camaudit',
    version: 1,
    exit_conditions: [{ event: 'reply_received' }],
    enroll: {
      trigger: 'lead_magnet_downloaded',
      lead_magnet: 'tenant-checklist',
    },
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

describe('seq diff D1 comparison', () => {
  it('validates slugs before passing them to Wrangler on Windows', () => {
    expect(assertValidSequenceSlug('camaudit-lead-magnet-tenant-checklist')).toBe(
      'camaudit-lead-magnet-tenant-checklist',
    )
    expect(() => assertValidSequenceSlug('camaudit"; echo injected')).toThrow(
      'Invalid sequence slug',
    )
    expect(() => assertValidSequenceSlug('../camaudit')).toThrow('Invalid sequence slug')
  })

  it('reports changed sequences with version and step deltas', () => {
    const local = sequence({
      version: 2,
      steps: [
        ...sequence().steps,
        {
          id: 'follow_up',
          delay: '1d',
          template: 'nurture/cam-audit-value-1',
          subject: 'One more thing',
        },
      ],
    })
    const remote = sequence()
    const diffs = buildSequenceDiffs(
      new Map([[local.slug, local]]),
      new Map([[remote.slug, remote]]),
      new Map([
        [
          remote.slug,
          {
            slug: remote.slug,
            product: remote.product,
            version: remote.version,
            definition: JSON.stringify(remote),
            compiled_from_sha: 'abc123',
          },
        ],
      ]),
    )

    expect(diffs).toEqual([
      {
        slug: local.slug,
        status: 'changed',
        product: 'camaudit',
        version: { remote: 1, local: 2 },
        steps: { remote: 1, local: 2 },
        compiledAt: null,
        compiledFromSha: 'abc123',
      },
    ])
  })

  it('reports local-only and D1-only sequences', () => {
    const local = sequence({ slug: 'local-only' })
    const remote = sequence({ slug: 'remote-only' })

    const diffs = buildSequenceDiffs(
      new Map([[local.slug, local]]),
      new Map([[remote.slug, remote]]),
    )

    expect(diffs).toEqual([
      {
        slug: 'local-only',
        status: 'new',
        product: 'camaudit',
      },
      {
        slug: 'remote-only',
        status: 'deleted',
        product: 'camaudit',
        compiledAt: null,
        compiledFromSha: null,
      },
    ])
  })

  it('returns a failing check exit code when sequence state has not converged', () => {
    expect(sequenceDiffExitCode([])).toBe(0)
    expect(
      sequenceDiffExitCode([
        {
          slug: 'remote-only',
          status: 'deleted',
          product: 'camaudit',
          compiledAt: null,
          compiledFromSha: null,
        },
      ]),
    ).toBe(1)
  })

  it('requires an explicit opt-in before deploy checks allow retired remote product deletions', () => {
    const retiredDeletion = {
      slug: 'skillledger-nurture-value-1',
      status: 'deleted',
      product: 'skillledger',
      compiledAt: null,
      compiledFromSha: null,
    } as const

    expect(sequenceDiffExitCode([retiredDeletion])).toBe(1)
    expect(sequenceDeletionExitCode([retiredDeletion])).toBe(1)
    expect(
      sequenceDiffExitCode([retiredDeletion], {
        allowRetiredDeletions: true,
      }),
    ).toBe(0)
    expect(
      sequenceDeletionExitCode([retiredDeletion], {
        allowRetiredDeletions: true,
      }),
    ).toBe(0)
  })

  it('recognizes GrantPipe remote rows as retirement deletions', () => {
    const retiredDeletion = {
      slug: 'grantpipe-lead-magnet-nurture',
      status: 'deleted',
      product: 'grantpipe',
      compiledAt: null,
      compiledFromSha: null,
    } as const

    expect(sequenceDeletionExitCode([retiredDeletion], { allowRetiredDeletions: true })).toBe(0)
  })

  it('returns a failing deletion check only for active remote sequences missing from the worktree', () => {
    expect(sequenceDeletionExitCode([])).toBe(0)
    expect(
      sequenceDeletionExitCode([
        {
          slug: 'local-only',
          status: 'new',
          product: 'camaudit',
        },
      ]),
    ).toBe(0)
    expect(
      sequenceDeletionExitCode([
        {
          slug: 'remote-only',
          status: 'deleted',
          product: 'camaudit',
          compiledAt: null,
          compiledFromSha: null,
        },
      ]),
    ).toBe(1)
  })

  it('parses D1 definition JSON through the sequence schema', () => {
    const remote = sequence()
    const parsed = parseRemoteSequences([
      {
        slug: remote.slug,
        product: remote.product,
        version: remote.version,
        definition: JSON.stringify(remote),
      },
    ])

    expect(parsed.get(remote.slug)).toEqual(remote)
  })

  it('parses retired remote definitions that no longer match the active product enum', () => {
    const remote = { ...sequence({ slug: 'skillledger-nurture-value-1' }), product: 'skillledger' }
    const parsed = parseRemoteSequences([
      {
        slug: remote.slug,
        product: 'skillledger',
        version: remote.version,
        definition: JSON.stringify(remote),
      },
    ])

    expect(parsed.get(remote.slug)).toMatchObject({
      slug: 'skillledger-nurture-value-1',
      product: 'skillledger',
      version: 1,
    })
  })

  it('rejects non-retired remote definitions that fail the active product enum', () => {
    const remote = { ...sequence({ slug: 'unknown-product-sequence' }), product: 'unknown' }

    expect(() =>
      parseRemoteSequences([
        {
          slug: remote.slug,
          product: 'unknown',
          version: remote.version,
          definition: JSON.stringify(remote),
        },
      ]),
    ).toThrow(/Invalid D1 sequence definition unknown-product-sequence/)
  })

  it('ignores unrelated invalid YAML files when loading one requested working sequence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sequencer-diff-'))
    try {
      const productDir = join(root, 'sequences', 'camaudit')
      mkdirSync(productDir, { recursive: true })
      const requested = sequence({ slug: 'requested-sequence' })
      writeFileSync(
        join(productDir, 'requested.yaml'),
        [
          `slug: ${requested.slug}`,
          `product: ${requested.product}`,
          `version: ${requested.version}`,
          'exit_conditions:',
          '  - event: reply_received',
          'enroll:',
          `  trigger: ${requested.enroll.trigger}`,
          `  lead_magnet: ${requested.enroll.lead_magnet}`,
          'variants:',
          '  - id: control',
          '    weight: 50',
          '  - id: shorter-subjects',
          '    weight: 50',
          'steps:',
          '  - id: deliver',
          '    delay: 0m',
          '    template: lead-magnets/tenant-checklist-delivery',
          '    subject: Your checklist',
          '',
        ].join('\n'),
      )
      writeFileSync(
        join(productDir, 'unrelated-broken.yaml'),
        ['slug: unrelated-broken', 'product: camaudit', ''].join('\n'),
      )

      const sequences = await loadWorkingSequences(root, requested.slug)

      expect([...sequences.keys()]).toEqual([requested.slug])
      expect(sequences.get(requested.slug)).toEqual(requested)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores unrelated malformed YAML files when loading one requested working sequence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sequencer-diff-'))
    try {
      const productDir = join(root, 'sequences', 'camaudit')
      mkdirSync(productDir, { recursive: true })
      const requested = sequence({ slug: 'requested-sequence' })
      writeFileSync(
        join(productDir, 'requested.yaml'),
        [
          `slug: ${requested.slug}`,
          `product: ${requested.product}`,
          `version: ${requested.version}`,
          'exit_conditions:',
          '  - event: reply_received',
          'enroll:',
          `  trigger: ${requested.enroll.trigger}`,
          `  lead_magnet: ${requested.enroll.lead_magnet}`,
          'variants:',
          '  - id: control',
          '    weight: 50',
          '  - id: shorter-subjects',
          '    weight: 50',
          'steps:',
          '  - id: deliver',
          '    delay: 0m',
          '    template: lead-magnets/tenant-checklist-delivery',
          '    subject: Your checklist',
          '',
        ].join('\n'),
      )
      writeFileSync(
        join(productDir, 'unrelated-broken.yaml'),
        ['slug: unrelated-broken', 'product: camaudit', 'steps: [', ''].join('\n'),
      )

      const sequences = await loadWorkingSequences(root, requested.slug)

      expect([...sequences.keys()]).toEqual([requested.slug])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports malformed YAML for the requested working sequence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sequencer-diff-'))
    try {
      const productDir = join(root, 'sequences', 'camaudit')
      mkdirSync(productDir, { recursive: true })
      writeFileSync(
        join(productDir, 'requested.yaml'),
        ['slug: requested-sequence', 'product: camaudit', 'steps: [', ''].join('\n'),
      )

      await expect(loadWorkingSequences(root, 'requested-sequence')).rejects.toThrow(
        /invalid sequence file/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses compiler validation when loading working sequences', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sequencer-diff-'))
    try {
      const productDir = join(root, 'sequences', 'camaudit')
      mkdirSync(productDir, { recursive: true })
      writeFileSync(
        join(productDir, 'requested.yaml'),
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

      await expect(loadWorkingSequences(root, 'requested-sequence')).rejects.toThrow(
        /unknown template slug/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
