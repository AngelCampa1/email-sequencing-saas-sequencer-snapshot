import { REQUIRED_LEAD_MAGNETS } from './required-lead-magnets.js'

export interface LiveProduct {
  slug: string
  id: string
  resendSecretName: string
}

export interface RequiredLeadMagnet {
  productSlug: string
  productId: string
  id: string
  slug: string
  name: string
  assetR2Bucket: string | null
  assetR2Key: string | null
  fulfillmentSequenceSlug: string
  conversionEventName: string
  fulfillmentOwner: 'sequencer' | 'product'
  sourceR2?: {
    bucket: string
    key: string
  }
}

export interface LeadMagnetReadinessRow {
  productSlug: string
  productId: string
  id: string
  slug: string
  name: string
  assetR2Bucket: string | null
  assetR2Key: string | null
  fulfillmentSequenceSlug: string | null
  conversionEventName: string | null
  active: boolean
  activeRows: number
}

export const LIVE_PRODUCTS: LiveProduct[] = [
  { slug: 'camaudit', id: 'prod_camaudit', resendSecretName: 'RESEND_API_KEY_CAMAUDIT' },
  { slug: 'floriva-web', id: 'prod_floriva_web', resendSecretName: 'RESEND_API_KEY_FLORIVA_WEB' },
]

export { REQUIRED_LEAD_MAGNETS }

export const REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS = REQUIRED_LEAD_MAGNETS.filter(
  (leadMagnet) => leadMagnet.fulfillmentOwner === 'sequencer',
)

export const RETIRED_SEQUENCE_SLUGS = ['camaudit-lead-magnet-tenant-checklist']

export const REQUIRED_PRODUCTION_SECRETS = [
  'SENTRY_DSN',
  'UNSUBSCRIBE_SIGNING_SECRET',
  'RESEND_WEBHOOK_SECRET',
  'INSTANTLY_WEBHOOK_SECRET',
  'INSTANTLY_API_KEY',
  ...LIVE_PRODUCTS.map((product) => product.resendSecretName),
]

export interface ReadinessState {
  secretNames: Set<string>
  productRows: Set<string>
  sequenceCounts: Map<string, number>
  sequenceSlugs?: Map<string, Set<string>>
  tokenCounts: Map<string, number>
  tokenServiceIds?: Map<string, string[]>
  leadMagnetCounts?: Map<string, number>
  leadMagnetRows?: Map<string, LeadMagnetReadinessRow>
  leadMagnetAssetKeys?: Set<string>
  leadMagnetAssetProbeFailures?: Map<string, string>
  retiredSequenceRows?: number
  pendingD1Migrations?: string[]
  skipSequenceConvergence?: boolean
}

export interface ProductReadiness {
  slug: string
  id: string
  resendSecretName: string
  productRow: boolean
  activeSequences: number
  activeTokenMappings: number
  invalidTokenMappings: number
}

export interface ReadinessReport {
  ok: boolean
  findings: string[]
  requiredSecrets: string[]
  presentSecrets: string[]
  requiredLeadMagnets: RequiredLeadMagnetReadiness[]
  retiredSequenceRows: number
  pendingD1Migrations: string[]
  products: ProductReadiness[]
}

export interface RequiredLeadMagnetReadiness extends RequiredLeadMagnet {
  activeRows: number
  assetPresent: boolean | null
}

export function validateRequiredLeadMagnetManifest(leadMagnets = REQUIRED_LEAD_MAGNETS): string[] {
  const errors: string[] = []
  const liveProducts = new Map(LIVE_PRODUCTS.map((product) => [product.slug, product.id]))
  const seenIds = new Map<string, string>()
  const seenSlugs = new Map<string, string>()
  const seenProductSlugs = new Map<string, string>()

  for (const leadMagnet of leadMagnets) {
    const label = `${leadMagnet.productSlug}/${leadMagnet.slug}`
    const expectedProductId = liveProducts.get(leadMagnet.productSlug)
    if (!expectedProductId) {
      errors.push(`Unknown lead magnet product: ${label}`)
    } else if (expectedProductId !== leadMagnet.productId) {
      errors.push(`Lead magnet product id mismatch: ${label}`)
    }

    const existingId = seenIds.get(leadMagnet.id)
    if (existingId) {
      errors.push(`Duplicate lead magnet id: ${leadMagnet.id} (${existingId}, ${label})`)
    }
    seenIds.set(leadMagnet.id, label)

    const existingSlug = seenSlugs.get(leadMagnet.slug)
    if (existingSlug) {
      errors.push(
        `Duplicate global lead magnet slug: ${leadMagnet.slug} (${existingSlug}, ${label})`,
      )
    }
    seenSlugs.set(leadMagnet.slug, label)

    const productSlugKey = `${leadMagnet.productSlug}/${leadMagnet.slug}`
    const existingProductSlug = seenProductSlugs.get(productSlugKey)
    if (existingProductSlug) {
      errors.push(
        `Duplicate product lead magnet slug: ${productSlugKey} (${existingProductSlug}, ${label})`,
      )
    }
    seenProductSlugs.set(productSlugKey, label)

    if (leadMagnet.fulfillmentOwner === 'sequencer') {
      if (!leadMagnet.assetR2Bucket || !leadMagnet.assetR2Key) {
        errors.push(`Sequencer lead magnet is missing a product asset location: ${label}`)
      }
    } else if (leadMagnet.assetR2Bucket || leadMagnet.assetR2Key) {
      errors.push(`Product-owned lead magnet must not define Sequencer asset storage: ${label}`)
    }
  }

  return errors
}

export function buildReadinessFindings(state: ReadinessState): string[] {
  const findings: string[] = []
  const liveProductSlugs = new Set(LIVE_PRODUCTS.map((product) => product.slug))
  const requiredLeadMagnetKeys = new Set(
    REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.map(requiredLeadMagnetKey),
  )

  for (const error of validateRequiredLeadMagnetManifest()) {
    findings.push(`Lead magnet manifest invalid: ${error}`)
  }

  for (const secret of REQUIRED_PRODUCTION_SECRETS) {
    if (!state.secretNames.has(secret)) {
      findings.push(`Missing production secret: ${secret}`)
    }
  }

  for (const productSlug of [...state.productRows].sort()) {
    if (!liveProductSlugs.has(productSlug)) {
      findings.push(`Unexpected production product row: ${productSlug}`)
    }
  }

  for (const product of LIVE_PRODUCTS) {
    if (!state.productRows.has(product.slug)) {
      findings.push(`Missing production product row: ${product.slug}`)
    }
    if (!state.skipSequenceConvergence && (state.sequenceCounts.get(product.slug) ?? 0) < 1) {
      findings.push(`No active sequence synced for product: ${product.slug}`)
    }
    if ((state.tokenCounts.get(product.slug) ?? 0) < 1) {
      findings.push(`No seq_api_tokens row for product: ${product.slug}`)
    }

    const invalidTokenMappings = (state.tokenServiceIds?.get(product.slug) ?? []).filter(
      isInvalidAccessServiceTokenSubject,
    )
    if (invalidTokenMappings.length > 0) {
      findings.push(
        `Invalid seq_api_tokens Access service token subject for product: ${product.slug}`,
      )
    }
  }

  if (!state.skipSequenceConvergence && (state.retiredSequenceRows ?? 0) > 0) {
    findings.push(`Retired product sequence rows still exist: ${state.retiredSequenceRows}`)
  }
  for (const retiredSlug of RETIRED_SEQUENCE_SLUGS) {
    for (const [productSlug, activeSlugs] of state.sequenceSlugs ?? []) {
      if (activeSlugs.has(retiredSlug)) {
        findings.push(`Retired sequence still active: ${productSlug}/${retiredSlug}`)
      }
    }
  }
  if ((state.pendingD1Migrations?.length ?? 0) > 0) {
    findings.push(`Pending D1 migrations: ${state.pendingD1Migrations!.join(', ')}`)
  }
  for (const [assetKey, reason] of [...(state.leadMagnetAssetProbeFailures ?? new Map())].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    findings.push(`Lead magnet R2 asset probe failed: ${assetKey}: ${reason}`)
  }

  for (const leadMagnet of REQUIRED_LEAD_MAGNETS) {
    const key = requiredLeadMagnetKey(leadMagnet)
    const row = state.leadMagnetRows?.get(key)
    const count = row ? 1 : (state.leadMagnetCounts?.get(key) ?? 0)
    if (leadMagnet.fulfillmentOwner === 'sequencer') {
      if (count < 1) {
        findings.push(
          `Missing active lead magnet row: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
        )
      } else if (row) {
        if (row.activeRows > 1) {
          findings.push(`Duplicate active lead magnet rows: ${key} (${row.activeRows})`)
        }
        const expectedFields: Array<[keyof LeadMagnetReadinessRow, string]> = [
          ['id', leadMagnet.id],
          ['productId', leadMagnet.productId],
          ['name', leadMagnet.name],
          ['assetR2Bucket', leadMagnet.assetR2Bucket ?? ''],
          ['assetR2Key', leadMagnet.assetR2Key ?? ''],
          ['fulfillmentSequenceSlug', leadMagnet.fulfillmentSequenceSlug],
          ['conversionEventName', leadMagnet.conversionEventName],
        ]
        for (const [field, expected] of expectedFields) {
          if (row[field] !== expected) {
            findings.push(`Lead magnet row mismatch: ${key} ${field}`)
          }
        }
      }
    }
    if (
      !state.skipSequenceConvergence &&
      state.sequenceSlugs &&
      !state.sequenceSlugs.get(leadMagnet.productSlug)?.has(leadMagnet.fulfillmentSequenceSlug)
    ) {
      findings.push(
        `Missing lead magnet fulfillment sequence: ${leadMagnet.productSlug}/${leadMagnet.fulfillmentSequenceSlug}`,
      )
    }
    if (leadMagnet.assetR2Bucket && leadMagnet.assetR2Key && state.leadMagnetAssetKeys) {
      const assetKey = requiredLeadMagnetAssetKey(leadMagnet)
      if (
        !state.leadMagnetAssetKeys.has(assetKey) &&
        !state.leadMagnetAssetProbeFailures?.has(assetKey)
      ) {
        findings.push(`Missing lead magnet R2 asset: ${assetKey}`)
      }
    }
  }

  for (const [key, row] of state.leadMagnetRows ?? []) {
    if (row.active && !requiredLeadMagnetKeys.has(key)) {
      findings.push(`Unexpected active lead magnet row: ${key}`)
    }
  }

  return findings
}

export function buildReadinessReport(state: ReadinessState): ReadinessReport {
  const findings = buildReadinessFindings(state)
  return {
    ok: findings.length === 0,
    findings,
    requiredSecrets: REQUIRED_PRODUCTION_SECRETS,
    presentSecrets: [...state.secretNames].sort(),
    requiredLeadMagnets: REQUIRED_LEAD_MAGNETS.map((leadMagnet) => ({
      ...leadMagnet,
      activeRows: activeLeadMagnetRows(state, leadMagnet),
      assetPresent:
        leadMagnet.assetR2Bucket && leadMagnet.assetR2Key
          ? leadMagnetAssetPresent(state, leadMagnet)
          : null,
    })),
    retiredSequenceRows: state.retiredSequenceRows ?? 0,
    pendingD1Migrations: state.pendingD1Migrations ?? [],
    products: LIVE_PRODUCTS.map((product) => ({
      slug: product.slug,
      id: product.id,
      resendSecretName: product.resendSecretName,
      productRow: state.productRows.has(product.slug),
      activeSequences: state.sequenceCounts.get(product.slug) ?? 0,
      activeTokenMappings: state.tokenCounts.get(product.slug) ?? 0,
      invalidTokenMappings: (state.tokenServiceIds?.get(product.slug) ?? []).filter(
        isInvalidAccessServiceTokenSubject,
      ).length,
    })),
  }
}

function leadMagnetAssetPresent(
  state: ReadinessState,
  leadMagnet: RequiredLeadMagnet,
): boolean | null {
  const assetKey = requiredLeadMagnetAssetKey(leadMagnet)
  if (state.leadMagnetAssetProbeFailures?.has(assetKey)) return null
  return state.leadMagnetAssetKeys?.has(assetKey) ?? null
}

function activeLeadMagnetRows(state: ReadinessState, leadMagnet: RequiredLeadMagnet): number {
  const key = requiredLeadMagnetKey(leadMagnet)
  return state.leadMagnetRows?.get(key)?.activeRows ?? state.leadMagnetCounts?.get(key) ?? 0
}

function requiredLeadMagnetKey(leadMagnet: RequiredLeadMagnet): string {
  return `${leadMagnet.productSlug}/${leadMagnet.slug}`
}

function isInvalidAccessServiceTokenSubject(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.length === 0 ||
    (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
    !/^[0-9a-f]{32}\.access$/i.test(trimmed)
  )
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlIdSuffix(slug: string): string {
  return slug.replace(/[^a-z0-9]/g, '_')
}

export function buildApiTokenSeedSql(serviceTokenIds = new Map<string, string>()): string {
  const values = LIVE_PRODUCTS.map((product) => {
    const suffix = sqlIdSuffix(product.slug)
    const serviceTokenId = serviceTokenIds.get(product.slug) ?? `<access_client_id_for_${suffix}>`
    return [
      `  (${sqlString(`tok_${suffix}_prod`)}`,
      sqlString(product.id),
      sqlString(`${product.slug} production`),
      sqlString(serviceTokenId),
      'NULL)',
    ].join(', ')
  })

  return [
    'INSERT INTO seq_api_tokens (id, product_id, label, access_service_token_id, revoked_at)',
    'VALUES',
    `${values.join(',\n')}`,
    'ON CONFLICT(id) DO UPDATE SET',
    '  product_id = excluded.product_id,',
    '  label = excluded.label,',
    '  access_service_token_id = excluded.access_service_token_id,',
    '  revoked_at = excluded.revoked_at;',
  ].join('\n')
}

export function buildRequiredLeadMagnetSeedSql(leadMagnets = REQUIRED_LEAD_MAGNETS): string {
  const manifestErrors = validateRequiredLeadMagnetManifest(leadMagnets)
  if (manifestErrors.length > 0) {
    throw new Error(manifestErrors.join('\n'))
  }

  const sequencerLeadMagnets = leadMagnets.filter(
    (leadMagnet) => leadMagnet.fulfillmentOwner === 'sequencer',
  )
  const productIdsWithManifestMagnets = [
    ...new Set(leadMagnets.map((leadMagnet) => leadMagnet.productId)),
  ].sort()
  const sequencerSlugsByProductId = new Map<string, string[]>()
  for (const leadMagnet of leadMagnets) {
    if (leadMagnet.fulfillmentOwner !== 'sequencer') continue
    const slugs = sequencerSlugsByProductId.get(leadMagnet.productId) ?? []
    slugs.push(leadMagnet.slug)
    sequencerSlugsByProductId.set(leadMagnet.productId, slugs)
  }

  const values = sequencerLeadMagnets.map((leadMagnet) => {
    if (!leadMagnet.assetR2Bucket || !leadMagnet.assetR2Key) {
      throw new Error(
        `Lead magnet is missing a product asset location: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
      )
    }
    return [
      `  (${sqlString(leadMagnet.id)}`,
      sqlString(leadMagnet.productId),
      sqlString(leadMagnet.slug),
      sqlString(leadMagnet.name),
      sqlString(leadMagnet.assetR2Bucket ?? ''),
      sqlString(leadMagnet.assetR2Key),
      sqlString(leadMagnet.fulfillmentSequenceSlug),
      sqlString(leadMagnet.conversionEventName),
      '1)',
    ].join(', ')
  })

  const insertLines =
    values.length === 0
      ? []
      : [
          'INSERT INTO seq_lead_magnets (id, product_id, slug, name, asset_r2_bucket, asset_r2_key, fulfillment_sequence_slug, conversion_event_name, active)',
          'VALUES',
          `${values.join(',\n')}`,
          'ON CONFLICT(slug) DO UPDATE SET',
          '  id = excluded.id,',
          '  product_id = excluded.product_id,',
          '  name = excluded.name,',
          '  asset_r2_bucket = excluded.asset_r2_bucket,',
          '  asset_r2_key = excluded.asset_r2_key,',
          '  fulfillment_sequence_slug = excluded.fulfillment_sequence_slug,',
          '  conversion_event_name = excluded.conversion_event_name,',
          '  active = excluded.active;',
        ]

  return [
    'BEGIN TRANSACTION;',
    ...insertLines,
    ...productIdsWithManifestMagnets.map((productId) => {
      const requiredSlugs = (sequencerSlugsByProductId.get(productId) ?? []).sort()
      if (requiredSlugs.length === 0) {
        return [
          'UPDATE seq_lead_magnets',
          'SET active = 0',
          `WHERE product_id = ${sqlString(productId)};`,
        ].join('\n')
      }
      return [
        'UPDATE seq_lead_magnets',
        'SET active = 0',
        `WHERE product_id = ${sqlString(productId)}`,
        `  AND slug NOT IN (${requiredSlugs.map(sqlString).join(', ')});`,
      ].join('\n')
    }),
    'COMMIT;',
  ].join('\n')
}

export function buildRequiredLeadMagnetAssetUploadPlan(
  leadMagnets = REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS,
): string {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$tempRoot = Join-Path $env:TEMP "sequencer-lead-magnet-verification"',
    'New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null',
    ...leadMagnets.flatMap((leadMagnet) => {
      if (!leadMagnet.assetR2Bucket || !leadMagnet.assetR2Key) {
        throw new Error(
          `Lead magnet is missing a product asset location: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
        )
      }
      const variableName = powerShellAssetVariableName(leadMagnet)
      const sourcePath = `$${variableName}`
      const r2ObjectPath = powerShellSingleQuotedString(
        `${leadMagnet.assetR2Bucket}/${leadMagnet.assetR2Key}`,
      )
      const localFileName = powerShellSingleQuotedString(
        `${leadMagnet.productSlug}-${leadMagnet.slug}`,
      )
      return [
        `${sourcePath} = Join-Path $tempRoot ${localFileName}`,
        `pnpm exec wrangler r2 object get ${r2ObjectPath} --remote --config 'apps/api/wrangler.toml' --file ${sourcePath}`,
        `if (-not (Test-Path -LiteralPath ${sourcePath} -PathType Leaf)) { throw "Missing lead magnet asset file: ${sourcePath}" }`,
      ]
    }),
  ]
  return lines.join('\n')
}

function requiredLeadMagnetAssetKey(leadMagnet: RequiredLeadMagnet): string {
  if (!leadMagnet.assetR2Bucket || !leadMagnet.assetR2Key) {
    throw new Error(
      `Lead magnet is missing a product asset location: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
    )
  }
  return `${leadMagnet.assetR2Bucket}/${leadMagnet.assetR2Key}`
}

function powerShellAssetVariableName(leadMagnet: RequiredLeadMagnet): string {
  return `${leadMagnet.productSlug}_${leadMagnet.slug}`.replace(/[^a-z0-9]/g, '_')
}

function powerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildSecretTemplateJson(secrets = REQUIRED_PRODUCTION_SECRETS): string {
  const template = Object.fromEntries(secrets.map((secret) => [secret, `<${secret}>`]))
  return `${JSON.stringify(template, null, 2)}\n`
}

export function buildAccessServiceTokenTemplateJson(): string {
  const template = Object.fromEntries(
    LIVE_PRODUCTS.map((product) => [
      product.slug,
      {
        product_id: product.id,
        cloudflare_service_token_name: `${product.slug}-service-token`,
        access_client_id: `<access_client_id_for_${sqlIdSuffix(product.slug)}>`,
        access_client_id_env: 'SEQUENCER_CF_ACCESS_CLIENT_ID',
        access_client_secret_env: 'SEQUENCER_CF_ACCESS_CLIENT_SECRET',
        note: 'Put the verified Access service-token client id in seq_api_tokens; store client id and client secret in the product app.',
      },
    ]),
  )
  return `${JSON.stringify(template, null, 2)}\n`
}

export interface AccessServiceTokenTemplateEntry {
  access_client_id?: string
  service_token_id?: string
}

export function parseAccessServiceTokenTemplate(input: string): Map<string, string> {
  const parsed = JSON.parse(input.replace(/^\uFEFF/, '')) as Record<
    string,
    AccessServiceTokenTemplateEntry
  >
  const serviceTokenIds = new Map<string, string>()
  const productByServiceTokenId = new Map<string, string>()
  const errors: string[] = []

  for (const product of LIVE_PRODUCTS) {
    const value =
      parsed[product.slug]?.access_client_id?.trim() ??
      parsed[product.slug]?.service_token_id?.trim() ??
      ''
    if (isInvalidAccessServiceTokenSubject(value)) {
      errors.push(`Missing real access_client_id for product: ${product.slug}`)
      continue
    }

    const existingProduct = productByServiceTokenId.get(value)
    if (existingProduct) {
      errors.push(`Duplicate service_token_id for products: ${existingProduct}, ${product.slug}`)
      continue
    }

    productByServiceTokenId.set(value, product.slug)
    serviceTokenIds.set(product.slug, value)
  }

  for (const slug of Object.keys(parsed)) {
    if (!LIVE_PRODUCTS.some((product) => product.slug === slug)) {
      errors.push(`Unexpected product in Access token template: ${slug}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  return serviceTokenIds
}

interface WranglerJsonResult<T> {
  results?: T[]
  success?: boolean
}

export function parseWranglerJsonOutput<T>(output: string): T[] {
  const lines = output.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('[')) continue

    try {
      const parsed = JSON.parse(lines.slice(i).join('\n')) as Array<WranglerJsonResult<T>>
      return parsed.flatMap((item) => item.results ?? [])
    } catch {}
  }

  return []
}

export function parseWranglerSecretListOutput(output: string): Array<{ name?: unknown }> {
  const lines = output.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('[')) continue

    try {
      const parsed = JSON.parse(lines.slice(i).join('\n')) as unknown
      return Array.isArray(parsed) ? (parsed as Array<{ name?: unknown }>) : []
    } catch {}
  }

  return []
}
