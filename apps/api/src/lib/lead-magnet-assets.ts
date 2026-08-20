import type { Env } from '../types'

export const DEFAULT_LEAD_MAGNET_ASSET_R2_BUCKET = 'sequencer-assets'

export function isSupportedLeadMagnetR2Bucket(bucketName: string): boolean {
  return getSupportedLeadMagnetR2BucketNames().has(bucketName)
}

export function getLeadMagnetR2Bucket(env: Env, bucketName: string): R2Bucket | undefined {
  switch (bucketName) {
    case 'sequencer-assets':
      return env.ASSETS_BUCKET
    case 'camaudit':
      return env.CAMAUDIT_ASSETS
    case 'floriva-lead-magnets':
      return env.FLORIVA_LEAD_MAGNETS
    default:
      return undefined
  }
}

function getSupportedLeadMagnetR2BucketNames(): ReadonlySet<string> {
  return new Set(['sequencer-assets', 'camaudit', 'floriva-lead-magnets'])
}
