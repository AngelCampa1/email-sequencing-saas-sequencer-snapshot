import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRequiredLeadMagnetAssetUploadPlan,
  buildRequiredLeadMagnetSeedSql,
  buildSecretTemplateJson,
  REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS,
} from '../lib/readiness.js'

const generatedArtifacts = [
  {
    path: 'dist/production-secrets.template.json',
    build: () => buildSecretTemplateJson(),
  },
  {
    path: 'dist/required-lead-magnets.sql',
    build: () => `${buildRequiredLeadMagnetSeedSql()}\n`,
  },
  {
    path: 'dist/required-lead-magnet-assets.ps1',
    build: () => `${buildRequiredLeadMagnetAssetUploadPlan()}\n`,
  },
]

function readGeneratedArtifact(path: string): string | null {
  const absolutePath = resolve(process.cwd(), path)
  if (!existsSync(absolutePath)) {
    return null
  }

  return readFileSync(absolutePath, 'utf8')
}

describe('generated deployment artifacts', () => {
  it.each(generatedArtifacts)('keeps $path in sync with the current generator', ({
    path,
    build,
  }) => {
    const artifact = readGeneratedArtifact(path)
    if (artifact === null) {
      return
    }

    expect(artifact).toBe(build())
  })

  it('generates current lead magnet seed rows and asset verification commands', () => {
    const sql = buildRequiredLeadMagnetSeedSql()
    const plan = buildRequiredLeadMagnetAssetUploadPlan()

    expect(sql).toContain('asset_r2_bucket')
    expect([...sql.matchAll(/\('lm_/g)]).toHaveLength(REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.length)
    expect(plan).not.toContain('r2 object put')
  })
})
