import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('product rollout audit documentation', () => {
  it('documents production readiness through live gate outputs instead of stale blocker snapshots', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const audit = readFileSync(resolve(repoRoot, 'docs/product-rollout-audit.md'), 'utf8')

    expect(audit).toContain('dist/readiness-report.json')
    expect(audit).toContain('pnpm seq readiness --remote')
    expect(audit).toContain('pnpm seq diff --check')
    expect(audit).toContain('Do not copy point-in-time blocker lists into this audit')
    expect(audit).not.toContain('Missing production secret: SENTRY_DSN')
    expect(audit).not.toContain('0007_product_brand_colors.sql')
    expect(audit).not.toContain('0009_cultured_killmonger.sql')
    expect(audit).not.toContain('0010_contact_timeline_indexes.sql')
    expect(audit).not.toContain('0011_unique_provider_events.sql')
    expect(audit).not.toContain('0012_delivered_messages.sql')
    expect(audit).not.toContain('Ready: 0 readiness findings')
    expect(audit).not.toContain('passes with 0 findings')
    expect(audit).not.toContain('There are no current production blockers')
    expect(audit).not.toContain('no migrations to apply')
  })

  it('keeps operator readiness docs aligned with the pending remote D1 migration gate', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const deploy = readFileSync(resolve(repoRoot, 'docs/deploy.md'), 'utf8')
    const rolloutReadiness = readFileSync(
      resolve(repoRoot, 'docs/product-rollout-readiness.md'),
      'utf8',
    )

    expect(deploy).toMatch(/readiness\. It verifies[\s\S]*no pending remote D1 migrations/i)
    expect(rolloutReadiness).toMatch(
      /readiness command must pass[\s\S]*no pending remote D1 migrations/i,
    )
  })

  it('documents migration releases as expand deploy contract instead of one-step migrate deploys', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const deploy = readFileSync(resolve(repoRoot, 'docs/deploy.md'), 'utf8')
    const operationsPlaybook = readFileSync(
      resolve(repoRoot, 'docs/operations-playbook.md'),
      'utf8',
    )
    const rolloutAudit = readFileSync(resolve(repoRoot, 'docs/product-rollout-audit.md'), 'utf8')

    for (const text of [deploy, operationsPlaybook, rolloutAudit]) {
      expect(text).toMatch(/expand\/deploy\/contract/i)
      expect(text).not.toContain('pnpm deploy:prod:migrate')
    }

    const migrationReleaseSection = deploy.slice(deploy.indexOf('### Migration releases'))
    const applyMigrationIndex = migrationReleaseSection.indexOf(
      'pnpm exec wrangler d1 migrations apply sequencer-db --remote',
    )
    const deployDryRunIndex = migrationReleaseSection.indexOf('pnpm deploy:prod:dry-run')
    expect(applyMigrationIndex).toBeGreaterThan(-1)
    expect(deployDryRunIndex).toBeGreaterThan(applyMigrationIndex)
  })

  it('documents explicit opt-in before writing placeholder token SQL files', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const deploy = readFileSync(resolve(repoRoot, 'docs/deploy.md'), 'utf8')
    const productIntegration = readFileSync(
      resolve(repoRoot, 'docs/product-client-integration.md'),
      'utf8',
    )

    expect(deploy).toContain(
      'pnpm seq token-sql --allow-placeholders --out dist/product-api-tokens.sql',
    )
    expect(deploy).not.toContain('pnpm seq token-sql --out dist/product-api-tokens.sql')
    expect(productIntegration).toContain(
      'pnpm seq token-sql --allow-placeholders --out dist/product-api-tokens.sql',
    )
    expect(productIntegration).not.toContain('pnpm seq token-sql --out dist/product-api-tokens.sql')
  })

  it('keeps one-click unsubscribe public routing in setup and deploy verification docs', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const setupCloudflare = readFileSync(resolve(repoRoot, 'scripts/setup-cloudflare.mjs'), 'utf8')
    const deploy = readFileSync(resolve(repoRoot, 'docs/deploy.md'), 'utf8')

    expect(setupCloudflare).toContain('Bypass /unsubscribe')
    expect(deploy).toMatch(
      /Confirm `\/unsubscribe\?email=.*product=.*` stores a product-scoped suppression without Cloudflare Access/i,
    )
  })

  it('keeps tokenized lead magnet asset bypass paths aligned across setup and rollout docs', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const setupCloudflare = readFileSync(resolve(repoRoot, 'scripts/setup-cloudflare.mjs'), 'utf8')
    const deploy = readFileSync(resolve(repoRoot, 'docs/deploy.md'), 'utf8')
    const rolloutReadiness = readFileSync(
      resolve(repoRoot, 'docs/product-rollout-readiness.md'),
      'utf8',
    )

    for (const text of [setupCloudflare, deploy, rolloutReadiness]) {
      expect(text).toContain('/assets/lead-magnets/*')
      expect(text).toContain('/api/v1/lead-magnets/*/asset')
    }
  })

  it('points production alert and logpush setup at the production Worker name', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const workersAlerts = readFileSync(resolve(repoRoot, 'docs/workers-alerts.md'), 'utf8')

    expect(workersAlerts).toContain('sequencer-api-production')
    expect(workersAlerts).not.toContain('Workers & Pages -> sequencer-api ->')
  })
})
