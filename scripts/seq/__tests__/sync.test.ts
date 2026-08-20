import { describe, expect, it } from 'vitest'
import { buildSyncStatements, resolveGitSha, wranglerD1ExecuteArgs } from '../commands/sync.js'

describe('seq sync command helpers', () => {
  it('builds argv for Wrangler without shell-composed file/database arguments', () => {
    expect(wranglerD1ExecuteArgs('sequencer-db', '--remote', 'C:/tmp/sequences sync.sql')).toEqual([
      'd1',
      'execute',
      'sequencer-db',
      '--remote',
      '--config',
      'apps/api/wrangler.toml',
      '--file',
      'C:/tmp/sequences sync.sql',
    ])
    expect(
      wranglerD1ExecuteArgs('sequencer-db', '--remote', 'C:/tmp/sequences sync.sql', 'production'),
    ).toEqual([
      'd1',
      'execute',
      'sequencer-db',
      '--remote',
      '--env',
      'production',
      '--config',
      'apps/api/wrangler.toml',
      '--file',
      'C:/tmp/sequences sync.sql',
    ])
  })

  it('rejects unsafe D1 database names before spawning Wrangler', () => {
    expect(() =>
      wranglerD1ExecuteArgs('sequencer-db; echo injected', '--local', 'dist/sequences-sync.sql'),
    ).toThrow('Invalid D1 database name')
  })

  it('escapes sequence JSON and git SHA values in generated upsert SQL', () => {
    const statements = buildSyncStatements(
      {
        compiled_at: '2026-05-19T00:00:00.000Z',
        sequences: [
          {
            slug: 'camaudit-lead-magnet-tenant-checklist',
            product: 'camaudit',
            version: 1,
            goal: "owner's goal",
            exit_conditions: [{ event: 'reply_received' }],
            steps: [
              {
                id: 'deliver',
                delay: '0m',
                template: 'lead-magnets/tenant-checklist-delivery',
                subject: "Here's your checklist",
              },
            ],
          },
        ],
      },
      "sha'withquote",
    )

    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain('Sequence slug cannot move products')
    expect(statements.join('\n')).not.toMatch(/\bCREATE\s+TEMP\b/i)
    const upsert = statements.find(
      (statement) =>
        statement.startsWith('INSERT INTO seq_sequences') && statement.includes('VALUES'),
    )
    expect(upsert).toContain("'owner''s goal'")
    expect(upsert).toContain("'sha''withquote'")
    expect(upsert).toContain("'prod_camaudit'")
  })

  it('guards against moving an existing sequence slug between products', () => {
    const statements = buildSyncStatements(
      {
        compiled_at: '2026-05-19T00:00:00.000Z',
        sequences: [
          {
            slug: 'shared-sequence-slug',
            product: 'floriva-web',
            version: 2,
            exit_conditions: [],
            steps: [],
          },
        ],
      },
      'abc1234',
    )

    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain('INSERT INTO seq_sequences')
    expect(statements[0]).toContain('SELECT NULL')
    expect(statements[0]).toContain('Sequence slug cannot move products')
    expect(statements[0]).toContain('shared-sequence-slug')
    expect(statements[0]).toContain("'prod_floriva_web'")
    expect(statements[0]).toContain('existing.product_id <> compiled.product_id')
    const upsert = statements.find(
      (statement) =>
        statement.startsWith('INSERT INTO seq_sequences') && statement.includes('VALUES'),
    )
    expect(upsert).not.toContain('product_id=excluded.product_id')
  })

  it('deactivates active live-product D1 sequences missing from the compiled bundle', () => {
    const statements = buildSyncStatements(
      {
        compiled_at: '2026-05-19T00:00:00.000Z',
        sequences: [
          {
            slug: 'kept-sequence',
            product: 'camaudit',
            version: 1,
            exit_conditions: [],
            steps: [],
          },
        ],
      },
      'abc1234',
    )

    const cleanup = statements.find((statement) => statement.startsWith('UPDATE seq_sequences'))
    expect(cleanup).toContain('is_active = 0')
    expect(cleanup).toContain("slug NOT IN ('kept-sequence')")
    expect(cleanup).toContain("'prod_camaudit'")
    expect(cleanup).toContain("'prod_floriva_web'")
    expect(cleanup).not.toContain("'prod_grantpipe'")
  })

  it('refuses to sync retired GrantPipe sequence definitions', () => {
    expect(() =>
      buildSyncStatements(
        {
          compiled_at: '2026-07-13T00:00:00.000Z',
          sequences: [
            {
              slug: 'grantpipe-retired',
              product: 'grantpipe',
              version: 1,
              exit_conditions: [],
              steps: [],
            },
          ],
        },
        'abc1234',
      ),
    ).toThrow('Unknown product slug: grantpipe')
  })

  it('emits product-move guards before any sequence writes', () => {
    const statements = buildSyncStatements(
      {
        compiled_at: '2026-05-19T00:00:00.000Z',
        sequences: [
          {
            slug: 'kept-sequence',
            product: 'camaudit',
            version: 1,
            exit_conditions: [],
            steps: [],
          },
          {
            slug: 'other-sequence',
            product: 'floriva-web',
            version: 1,
            exit_conditions: [],
            steps: [],
          },
        ],
      },
      'abc1234',
    )

    expect(statements[0]).toContain("('kept-sequence', 'prod_camaudit')")
    expect(statements[0]).toContain("('other-sequence', 'prod_floriva_web')")
    expect(statements[1]).toContain("VALUES ('kept-sequence'")
    expect(statements[2]).toContain("VALUES ('other-sequence'")
  })

  it('uses a flat compiled sequence guard for large bundles instead of a deep OR expression tree', () => {
    const statements = buildSyncStatements(
      {
        compiled_at: '2026-05-19T00:00:00.000Z',
        sequences: Array.from({ length: 120 }, (_, index) => ({
          slug: `camaudit-sequence-${index}`,
          product: 'camaudit',
          version: 1,
          exit_conditions: [],
          steps: [],
        })),
      },
      'abc1234',
    )

    expect(statements[0]).toContain('WITH compiled_sequences(slug, product_id) AS (VALUES')
    expect(statements[0]).toContain("('camaudit-sequence-119', 'prod_camaudit')")
    expect(statements[0]).not.toContain(' OR ')
  })

  it('requires a resolved git SHA for remote sync unless one is provided', () => {
    expect(() =>
      resolveGitSha('C:/repo', undefined, true, () => {
        throw new Error('not a git checkout')
      }),
    ).toThrow('Unable to resolve git SHA for remote sync')

    expect(
      resolveGitSha('C:/repo', undefined, false, () => {
        throw new Error('not a git checkout')
      }),
    ).toBe('unknown')

    expect(() => resolveGitSha('C:/repo', 'unknown', true, () => 'ignored')).toThrow(
      'Remote sync --git-sha must be a Git SHA',
    )
    expect(resolveGitSha('C:/repo', 'abc1234', true, () => 'ignored')).toBe('abc1234')
  })
})
