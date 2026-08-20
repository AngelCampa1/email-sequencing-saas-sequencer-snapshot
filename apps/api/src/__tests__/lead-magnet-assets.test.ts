import { describe, expect, it } from 'vitest'
import { REQUIRED_LEAD_MAGNETS } from '../../../../scripts/seq/lib/required-lead-magnets'
import { getLeadMagnetR2Bucket, isSupportedLeadMagnetR2Bucket } from '../lib/lead-magnet-assets'
import type { Env } from '../types'

// A mock Env where every R2 binding the Worker declares is present, so the only
// reason a bucket name fails to resolve is a missing case in getLeadMagnetR2Bucket.
const bucketEnv = {
  ASSETS_BUCKET: { name: 'sequencer-assets' },
  CAMAUDIT_ASSETS: { name: 'camaudit' },
  FLORIVA_LEAD_MAGNETS: { name: 'floriva-lead-magnets' },
} as unknown as Env

describe('lead magnet R2 bucket resolution', () => {
  it('maps the shared Sequencer bucket name to its binding', () => {
    expect(isSupportedLeadMagnetR2Bucket('sequencer-assets')).toBe(true)
    expect(getLeadMagnetR2Bucket(bucketEnv, 'sequencer-assets')).toBe(bucketEnv.ASSETS_BUCKET)
  })

  it('maps the camaudit bucket name to its dedicated binding', () => {
    expect(isSupportedLeadMagnetR2Bucket('camaudit')).toBe(true)
    expect(getLeadMagnetR2Bucket(bucketEnv, 'camaudit')).toBe(bucketEnv.CAMAUDIT_ASSETS)
  })

  it('does not resolve the retired GrantPipe document bucket', () => {
    expect(isSupportedLeadMagnetR2Bucket('grantpipe-documents')).toBe(false)
    expect(getLeadMagnetR2Bucket(bucketEnv, 'grantpipe-documents')).toBeUndefined()
  })

  it('resolves every asset bucket referenced by the required lead magnet manifest', () => {
    const buckets = new Set(
      REQUIRED_LEAD_MAGNETS.map((lm) => lm.assetR2Bucket).filter(
        (b): b is string => typeof b === 'string' && b.length > 0,
      ),
    )
    expect(buckets.size).toBeGreaterThan(0)

    const unresolved = [...buckets].filter(
      (bucket) =>
        !isSupportedLeadMagnetR2Bucket(bucket) || !getLeadMagnetR2Bucket(bucketEnv, bucket),
    )
    expect(unresolved).toEqual([])
  })
})
