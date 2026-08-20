import { ProductSlugSchema } from '@sequencer/shared'
import { describe, expect, it } from 'vitest'
import {
  assertValidD1DatabaseName,
  isMissingR2ObjectError,
  isRetryableWranglerError,
  pendingD1MigrationsFromRows,
  pendingD1MigrationsFromText,
  probeRemoteLeadMagnetAssetReadiness,
  probeRemoteLeadMagnetAssets,
  requiredRemoteLeadMagnetAssetKeys,
  runAsync,
  wranglerD1ExecuteArgs,
  wranglerD1MigrationsListArgs,
  wranglerR2ObjectGetArgs,
  wranglerSecretListArgs,
  wranglerWhoamiArgs,
} from '../commands/readiness.js'
import {
  buildAccessServiceTokenTemplateJson,
  buildApiTokenSeedSql,
  buildReadinessFindings,
  buildReadinessReport,
  buildRequiredLeadMagnetAssetUploadPlan,
  buildRequiredLeadMagnetSeedSql,
  buildSecretTemplateJson,
  type LeadMagnetReadinessRow,
  LIVE_PRODUCTS,
  parseAccessServiceTokenTemplate,
  parseWranglerJsonOutput,
  parseWranglerSecretListOutput,
  REQUIRED_LEAD_MAGNETS,
  REQUIRED_PRODUCTION_SECRETS,
  REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS,
  type RequiredLeadMagnet,
  validateRequiredLeadMagnetManifest,
} from '../lib/readiness.js'

const RETIRED_PRODUCTS = [
  'capveri',
  'gathergrove',
  'geoleap',
  'skillledger',
  'kaiplan',
  'lextract',
  'pebbledesk',
  'boardstack',
  'phiguard',
  'grantpipe',
] as const

function requiredLeadMagnetKey(leadMagnet: RequiredLeadMagnet): string {
  return `${leadMagnet.productSlug}/${leadMagnet.slug}`
}

function leadMagnetReadinessRows(
  leadMagnets = REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS,
  overrides = new Map<string, Partial<LeadMagnetReadinessRow>>(),
): Map<string, LeadMagnetReadinessRow> {
  return new Map(
    leadMagnets.map((leadMagnet) => {
      const key = requiredLeadMagnetKey(leadMagnet)
      return [
        key,
        {
          productSlug: leadMagnet.productSlug,
          productId: leadMagnet.productId,
          id: leadMagnet.id,
          slug: leadMagnet.slug,
          name: leadMagnet.name,
          assetR2Bucket: leadMagnet.assetR2Bucket,
          assetR2Key: leadMagnet.assetR2Key,
          fulfillmentSequenceSlug: leadMagnet.fulfillmentSequenceSlug,
          conversionEventName: leadMagnet.conversionEventName,
          active: true,
          activeRows: 1,
          ...overrides.get(key),
        },
      ]
    }),
  )
}

function sequenceSlugMap(): Map<string, Set<string>> {
  return new Map(
    LIVE_PRODUCTS.map((product) => [
      product.slug,
      new Set(
        REQUIRED_LEAD_MAGNETS.filter((leadMagnet) => leadMagnet.productSlug === product.slug).map(
          (leadMagnet) => leadMagnet.fulfillmentSequenceSlug,
        ),
      ),
    ]),
  )
}

describe('readiness manifest', () => {
  it('contains the current live product set and excludes inactive products', () => {
    expect(LIVE_PRODUCTS.map((product) => product.slug).sort()).toEqual(['camaudit', 'floriva-web'])
    for (const product of RETIRED_PRODUCTS) {
      expect(LIVE_PRODUCTS.map((candidate) => candidate.slug)).not.toContain(product)
      expect(REQUIRED_PRODUCTION_SECRETS).not.toContain(
        `RESEND_API_KEY_${product.replace(/-/g, '_').toUpperCase()}`,
      )
    }
    expect(LIVE_PRODUCTS.map((product) => product.slug)).not.toContain('reachally')
    expect(LIVE_PRODUCTS.map((product) => product.slug)).not.toContain('a11yproof')
  })

  it('keeps the CLI live product manifest aligned with runtime product validation', () => {
    expect(LIVE_PRODUCTS.map((product) => product.slug)).toEqual(ProductSlugSchema.options)
  })

  it('uses underscore-normalized Resend secret names for hyphenated products', () => {
    expect(REQUIRED_PRODUCTION_SECRETS).toContain('RESEND_API_KEY_FLORIVA_WEB')
    expect(REQUIRED_PRODUCTION_SECRETS).not.toContain('RESEND_API_KEY_FLORIVA-WEB')
  })

  it('rejects unsafe D1 database names before building wrangler shell commands', () => {
    expect(assertValidD1DatabaseName('sequencer-db')).toBe('sequencer-db')
    expect(assertValidD1DatabaseName('sequencer_db_2026')).toBe('sequencer_db_2026')
    expect(() => assertValidD1DatabaseName('sequencer-db & echo pwned')).toThrow(
      'Invalid D1 database name',
    )
    expect(() => assertValidD1DatabaseName('sequencer-db; echo pwned')).toThrow(
      'Invalid D1 database name',
    )
  })

  it('only treats known R2 object-not-found errors as missing assets', () => {
    expect(isMissingR2ObjectError({ stderr: 'ERROR: object not found' })).toBe(true)
    expect(isMissingR2ObjectError({ stderr: 'NoSuchKey: key does not exist' })).toBe(true)
    expect(isMissingR2ObjectError({ stderr: 'Authentication error [code: 10000]' })).toBe(false)
    expect(isMissingR2ObjectError({ stderr: 'A request to the Cloudflare API failed' })).toBe(false)
  })

  it('retries transient Wrangler failures in async remote probes', async () => {
    expect(isRetryableWranglerError({ stderr: "The request to Cloudflare's API timed out." })).toBe(
      true,
    )
    expect(isRetryableWranglerError({ stderr: 'A request to the Cloudflare API failed' })).toBe(
      true,
    )
    expect(isRetryableWranglerError({ stderr: 'ERROR: fetch failed' })).toBe(true)
    expect(isRetryableWranglerError({ stderr: 'permission denied' })).toBe(false)

    let attempts = 0
    const stdout = await runAsync(['wrangler', 'command'], 'C:\\repo', {
      sleep: async () => {},
      execute: async () => {
        attempts += 1
        if (attempts < 3) {
          throw { stderr: 'ERROR: fetch failed' }
        }
        return { stdout: 'ok' }
      },
    })

    expect(stdout).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('does not retry non-transient async command failures', async () => {
    let attempts = 0
    await expect(
      runAsync(['wrangler', 'command'], 'C:\\repo', {
        sleep: async () => {},
        execute: async () => {
          attempts += 1
          throw { stderr: 'permission denied' }
        },
      }),
    ).rejects.toMatchObject({ stderr: 'permission denied' })

    expect(attempts).toBe(1)
  })

  it('builds Wrangler argv arrays for readiness checks without shell quoting', () => {
    expect(wranglerWhoamiArgs()).toEqual(['whoami'])
    expect(wranglerSecretListArgs()).toEqual(['secret', 'list', '--env', 'production'])
    expect(wranglerD1MigrationsListArgs('sequencer-db', '--remote')).toEqual([
      'd1',
      'migrations',
      'list',
      'sequencer-db',
      '--remote',
    ])
    expect(
      wranglerD1ExecuteArgs(
        'sequencer-db',
        '--remote',
        'SELECT slug FROM seq_products WHERE slug = "camaudit";',
      ),
    ).toEqual([
      'd1',
      'execute',
      'sequencer-db',
      '--remote',
      '--json',
      '--command',
      'SELECT slug FROM seq_products WHERE slug = "camaudit";',
    ])
    expect(
      wranglerR2ObjectGetArgs(
        'camaudit',
        'guides/cam-reconciliation-audit-checklist.pdf',
        'C:\\Temp\\asset with spaces.pdf',
      ),
    ).toEqual([
      'r2',
      'object',
      'get',
      'camaudit/guides/cam-reconciliation-audit-checklist.pdf',
      '--remote',
      '--file',
      'C:\\Temp\\asset with spaces.pdf',
    ])
    expect(() =>
      wranglerD1ExecuteArgs('sequencer-db & echo pwned', '--remote', 'SELECT 1;'),
    ).toThrow('Invalid D1 database name')
    expect(() => wranglerD1MigrationsListArgs('sequencer-db & echo pwned', '--remote')).toThrow(
      'Invalid D1 database name',
    )
  })

  it('detects pending D1 migrations from Wrangler JSON rows', () => {
    expect(
      pendingD1MigrationsFromRows([
        { name: '0012_delivered_messages', applied_at: '2026-05-20T00:00:00.000Z' },
        { name: '0013_contact_source_label', applied_at: null },
        { name: '0014_future', applied: false },
        { name: '0015_name_only_pending' },
        { name: '0016_explicitly_applied', applied: true },
      ]),
    ).toEqual(['0013_contact_source_label', '0014_future', '0015_name_only_pending'])
  })

  it('detects pending D1 migrations from Wrangler text output', () => {
    expect(
      pendingD1MigrationsFromText(
        [
          'Migrations to be applied:',
          '┌───────────────────────────┐',
          '│ name                      │',
          '├───────────────────────────┤',
          '│ 0013_contact_source_label │',
          '│ 0014_future               │',
          '└───────────────────────────┘',
        ].join('\n'),
      ),
    ).toEqual(['0013_contact_source_label', '0014_future'])

    expect(pendingD1MigrationsFromText('No migrations to apply!')).toEqual([])
  })

  it('collects remote lead magnet asset keys from the async probe path', async () => {
    const commands: string[][] = []
    const assets = [
      { bucket: 'bucket-a', key: 'lead-magnets/a.pdf' },
      { bucket: 'bucket-b', key: 'lead-magnets/b.pdf' },
      { bucket: 'bucket-c', key: 'lead-magnets/missing.pdf' },
    ]

    const present = await probeRemoteLeadMagnetAssets('C:\\repo\\apps\\api', {
      assets,
      runCommand: async (args) => {
        commands.push(args)
        if (args.includes('bucket-c/lead-magnets/missing.pdf')) {
          throw { stderr: 'NoSuchKey: key does not exist' }
        }
        return 'downloaded'
      },
    })

    expect(present).toEqual(new Set(['bucket-a/lead-magnets/a.pdf', 'bucket-b/lead-magnets/b.pdf']))
    expect(commands).toHaveLength(3)
    expect(commands.every((args) => args.slice(0, 3).join(' ') === 'r2 object get')).toBe(true)
    expect(commands.every((args) => args.includes('--file'))).toBe(true)
  })

  it('reports remote lead magnet asset probe command failures without mislabeling them as missing assets', async () => {
    const probedLeadMagnet = REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS[0]!
    const probedAssetKey = `${probedLeadMagnet.assetR2Bucket}/${probedLeadMagnet.assetR2Key}`
    const probe = await probeRemoteLeadMagnetAssetReadiness('C:\\repo\\apps\\api', {
      assets: [{ bucket: probedLeadMagnet.assetR2Bucket, key: probedLeadMagnet.assetR2Key }],
      runCommand: async () => {
        throw { stderr: "Unable to resolve Cloudflare's API hostname" }
      },
    })

    expect(probe.present).toEqual(new Set())
    expect(probe.failures).toEqual(
      new Map([[probedAssetKey, "Unable to resolve Cloudflare's API hostname"]]),
    )

    const report = buildReadinessReport({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      sequenceSlugs: sequenceSlugMap(),
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: leadMagnetReadinessRows(),
      leadMagnetAssetKeys: probe.present,
      leadMagnetAssetProbeFailures: probe.failures,
      retiredSequenceRows: 0,
    })

    expect(report.findings).toContain(
      `Lead magnet R2 asset probe failed: ${probedAssetKey}: Unable to resolve Cloudflare's API hostname`,
    )
    expect(report.findings).not.toContain(`Missing lead magnet R2 asset: ${probedAssetKey}`)
    expect(
      report.requiredLeadMagnets.find(
        (leadMagnet) =>
          leadMagnet.assetR2Bucket === probedLeadMagnet.assetR2Bucket &&
          leadMagnet.assetR2Key === probedLeadMagnet.assetR2Key,
      )?.assetPresent,
    ).toBeNull()
  })

  it('reports missing secrets and product token mappings by product', () => {
    const findings = buildReadinessFindings({
      secretNames: new Set(['RESEND_WEBHOOK_SECRET', 'INSTANTLY_WEBHOOK_SECRET']),
      productRows: new Set(['camaudit', 'floriva-web', 'reachally']),
      sequenceCounts: new Map([
        ['camaudit', 1],
        ['floriva-web', 2],
      ]),
      sequenceSlugs: new Map(),
      tokenCounts: new Map([
        ['camaudit', 1],
        ['floriva-web', 0],
      ]),
      tokenServiceIds: new Map([
        ['camaudit', ['<access_client_id_for_camaudit>']],
        ['floriva-web', []],
      ]),
      leadMagnetRows: new Map(),
      leadMagnetAssetKeys: new Set(),
      retiredSequenceRows: 2,
      pendingD1Migrations: ['0013_contact_source_label'],
    })

    expect(findings).toContain('Missing production secret: RESEND_API_KEY_FLORIVA_WEB')
    expect(findings).toContain('Unexpected production product row: reachally')
    expect(findings).toContain('No seq_api_tokens row for product: floriva-web')
    expect(findings).toContain(
      'Invalid seq_api_tokens Access service token subject for product: camaudit',
    )
    expect(findings.some((finding) => finding.includes('grantpipe'))).toBe(false)
    expect(findings).toContain('Retired product sequence rows still exist: 2')
    expect(findings).toContain('Pending D1 migrations: 0013_contact_source_label')
    expect(findings).toContain(
      'Missing active lead magnet row: camaudit/cam-reconciliation-checklist',
    )
    expect(findings).toContain(
      'Missing lead magnet fulfillment sequence: camaudit/camaudit-cam-reconciliation-checklist',
    )
    expect(findings).toContain(
      'Missing lead magnet R2 asset: camaudit/guides/cam-reconciliation-audit-checklist.pdf',
    )
  })

  it('builds a structured readiness report with pass/fail status', () => {
    const report = buildReadinessReport({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      tokenServiceIds: new Map(
        LIVE_PRODUCTS.map((product, index) => [
          product.slug,
          [`${String(index + 1).padStart(32, '0')}.access`],
        ]),
      ),
      leadMagnetRows: leadMagnetReadinessRows(),
      leadMagnetAssetKeys: new Set(
        REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.map(
          (leadMagnet) => `${leadMagnet.assetR2Bucket}/${leadMagnet.assetR2Key}`,
        ),
      ),
      retiredSequenceRows: 0,
    })

    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.products).toHaveLength(LIVE_PRODUCTS.length)
    expect(report.products.find((product) => product.slug === 'floriva-web')).toMatchObject({
      productRow: true,
      activeSequences: 1,
      activeTokenMappings: 1,
      invalidTokenMappings: 0,
    })
    expect(report.retiredSequenceRows).toBe(0)
    expect(
      [...new Set(report.requiredLeadMagnets.map((leadMagnet) => leadMagnet.productSlug))].sort(),
    ).toEqual(LIVE_PRODUCTS.map((product) => product.slug).sort())
    expect(
      report.requiredLeadMagnets
        .filter((leadMagnet) => leadMagnet.fulfillmentOwner === 'sequencer')
        .every((leadMagnet) => leadMagnet.activeRows === 1),
    ).toBe(true)
    expect(
      report.requiredLeadMagnets
        .filter((leadMagnet) => leadMagnet.fulfillmentOwner === 'product')
        .every((leadMagnet) => leadMagnet.activeRows === 0),
    ).toBe(true)
    expect(
      report.requiredLeadMagnets
        .filter((leadMagnet) => leadMagnet.fulfillmentOwner === 'sequencer')
        .every((leadMagnet) => leadMagnet.assetPresent === true),
    ).toBe(true)
    expect(
      report.requiredLeadMagnets
        .filter((leadMagnet) => leadMagnet.fulfillmentOwner === 'product')
        .every((leadMagnet) => leadMagnet.assetPresent === null),
    ).toBe(true)
  })

  it('preserves duplicate active lead magnet row counts when row details include them', () => {
    const leadMagnet = REQUIRED_LEAD_MAGNETS[0]!
    const key = requiredLeadMagnetKey(leadMagnet)
    const report = buildReadinessReport({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      sequenceSlugs: sequenceSlugMap(),
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: leadMagnetReadinessRows(
        REQUIRED_LEAD_MAGNETS,
        new Map([[key, { activeRows: 2 }]]),
      ),
      leadMagnetAssetKeys: new Set(
        REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.map(
          (candidate) => `${candidate.assetR2Bucket}/${candidate.assetR2Key}`,
        ),
      ),
      retiredSequenceRows: 0,
    })

    expect(
      report.requiredLeadMagnets.find((candidate) => candidate.slug === leadMagnet.slug)
        ?.activeRows,
    ).toBe(2)
    expect(report.findings).toContain(`Duplicate active lead magnet rows: ${key} (2)`)
  })

  it('reports stale active lead magnet rows that are no longer required', () => {
    const rows = leadMagnetReadinessRows()
    rows.set('camaudit/cam-pre-send-packet-checklist', {
      productSlug: 'camaudit',
      productId: 'prod_camaudit',
      id: 'lm_camaudit_cam_pre_send_packet_checklist',
      slug: 'cam-pre-send-packet-checklist',
      name: 'Old tenant checklist',
      assetR2Bucket: 'camaudit',
      assetR2Key: 'guides/cam-pre-send-packet-checklist.pdf',
      fulfillmentSequenceSlug: 'camaudit-lead-magnet-tenant-checklist',
      conversionEventName: 'cam_pre_send_packet_checklist_downloaded',
      active: true,
      activeRows: 1,
    })

    const findings = buildReadinessFindings({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      sequenceSlugs: sequenceSlugMap(),
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: rows,
      retiredSequenceRows: 0,
    })

    expect(findings).toContain(
      'Unexpected active lead magnet row: camaudit/cam-pre-send-packet-checklist',
    )
  })

  it('reports retired CAMAudit sequences that are still active', () => {
    const slugs = sequenceSlugMap()
    slugs.get('camaudit')?.add('camaudit-lead-magnet-tenant-checklist')

    const findings = buildReadinessFindings({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      sequenceSlugs: slugs,
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: leadMagnetReadinessRows(),
      retiredSequenceRows: 0,
    })

    expect(findings).toContain(
      'Retired sequence still active: camaudit/camaudit-lead-magnet-tenant-checklist',
    )
  })

  it('does not require product-owned lead magnet rows', () => {
    const productOwnedLeadMagnet = REQUIRED_LEAD_MAGNETS.find(
      (candidate) => candidate.fulfillmentOwner === 'product',
    )
    expect(productOwnedLeadMagnet).toBeUndefined()
  })

  it('marks lead magnet asset presence as not checked when asset keys are not provided', () => {
    const report = buildReadinessReport({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: leadMagnetReadinessRows(),
      retiredSequenceRows: 0,
    })

    expect(report.requiredLeadMagnets[0]?.assetPresent).toBeNull()
    const leadMagnet = REQUIRED_LEAD_MAGNETS[0]!
    expect(report.findings).not.toContain(
      `Missing lead magnet R2 asset: ${leadMagnet.assetR2Bucket}/${leadMagnet.assetR2Key}`,
    )
  })

  it('tracks required active lead magnet rows', () => {
    expect(
      [...new Set(REQUIRED_LEAD_MAGNETS.map((leadMagnet) => leadMagnet.productSlug))].sort(),
    ).toEqual(LIVE_PRODUCTS.map((product) => product.slug).sort())
    expect(validateRequiredLeadMagnetManifest()).toEqual([])
    expect(new Set(REQUIRED_LEAD_MAGNETS.map((leadMagnet) => leadMagnet.slug)).size).toBe(
      REQUIRED_LEAD_MAGNETS.length,
    )
    expect(new Set(REQUIRED_LEAD_MAGNETS.map((leadMagnet) => leadMagnet.id)).size).toBe(
      REQUIRED_LEAD_MAGNETS.length,
    )
    expect(
      REQUIRED_LEAD_MAGNETS.every((leadMagnet) =>
        LIVE_PRODUCTS.some(
          (product) =>
            product.slug === leadMagnet.productSlug && product.id === leadMagnet.productId,
        ),
      ),
    ).toBe(true)
    expect(REQUIRED_LEAD_MAGNETS.length).toBeGreaterThan(LIVE_PRODUCTS.length)
    expect(
      REQUIRED_LEAD_MAGNETS.every((leadMagnet) => leadMagnet.fulfillmentSequenceSlug.length > 0),
    ).toBe(true)
    expect(
      REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.every((leadMagnet) => leadMagnet.assetR2Key),
    ).toBe(true)
    expect(
      REQUIRED_LEAD_MAGNETS.filter((leadMagnet) => leadMagnet.fulfillmentOwner === 'product')
        .map((leadMagnet) => leadMagnet.productSlug)
        .sort(),
    ).toEqual([])
  })

  it('keeps current CAMAudit partner magnets off the retired tenant checklist sequence', () => {
    const camauditMagnets = REQUIRED_LEAD_MAGNETS.filter(
      (leadMagnet) => leadMagnet.productSlug === 'camaudit',
    )

    expect(camauditMagnets).toHaveLength(50)
    for (const leadMagnet of camauditMagnets) {
      expect(leadMagnet.fulfillmentOwner).toBe('sequencer')
      expect(leadMagnet.fulfillmentSequenceSlug).toBe(`camaudit-${leadMagnet.slug}`)
      expect(leadMagnet.fulfillmentSequenceSlug).not.toBe('camaudit-lead-magnet-tenant-checklist')
      expect(leadMagnet.assetR2Bucket).toBe('camaudit')
      expect(leadMagnet.assetR2Key).toMatch(/^guides\/.+\.(pdf|xlsx)$/)
    }
  })

  it('rejects unsafe lead magnet manifest drift before SQL is emitted', () => {
    const [first, second] = REQUIRED_LEAD_MAGNETS
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    const errors = validateRequiredLeadMagnetManifest([
      first!,
      {
        ...second!,
        id: first!.id,
        slug: first!.slug,
      },
      {
        ...first!,
        id: 'lm_bad_storage',
        slug: 'bad-storage',
        assetR2Bucket: null,
        assetR2Key: null,
        fulfillmentOwner: 'sequencer',
      },
    ])

    expect(errors).toContain(
      `Duplicate lead magnet id: ${first!.id} (${first!.productSlug}/${first!.slug}, ${second!.productSlug}/${first!.slug})`,
    )
    expect(errors).toContain(
      `Duplicate global lead magnet slug: ${first!.slug} (${first!.productSlug}/${first!.slug}, ${second!.productSlug}/${first!.slug})`,
    )
    expect(errors).toContain(
      `Sequencer lead magnet is missing a product asset location: ${first!.productSlug}/bad-storage`,
    )
  })

  it('rejects product-owned storage declarations and invalid SQL or asset plan manifests', () => {
    const first = REQUIRED_LEAD_MAGNETS[0]!
    const invalid = {
      ...first,
      fulfillmentOwner: 'product' as const,
    }

    expect(validateRequiredLeadMagnetManifest([invalid])).toContain(
      `Product-owned lead magnet must not define Sequencer asset storage: ${first.productSlug}/${first.slug}`,
    )
    expect(() =>
      buildRequiredLeadMagnetSeedSql([{ ...first, assetR2Bucket: null, assetR2Key: null }]),
    ).toThrow('missing a product asset location')
    expect(() =>
      buildRequiredLeadMagnetAssetUploadPlan([{ ...first, assetR2Bucket: null, assetR2Key: null }]),
    ).toThrow('missing a product asset location')
  })

  it('reports missing active lead magnet rows for every required product magnet', () => {
    for (const leadMagnet of REQUIRED_LEAD_MAGNETS) {
      const rows = leadMagnetReadinessRows()
      rows.delete(requiredLeadMagnetKey(leadMagnet))

      const findings = buildReadinessFindings({
        secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
        productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
        sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
        tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
        leadMagnetRows: rows,
        retiredSequenceRows: 0,
      })

      if (leadMagnet.fulfillmentOwner === 'sequencer') {
        expect(findings).toContain(
          `Missing active lead magnet row: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
        )
      } else {
        expect(findings).not.toContain(
          `Missing active lead magnet row: ${leadMagnet.productSlug}/${leadMagnet.slug}`,
        )
      }
    }
  })

  it('reports lead magnet row field mismatches', () => {
    const leadMagnet = REQUIRED_LEAD_MAGNETS[0]
    expect(leadMagnet).toBeDefined()
    const key = requiredLeadMagnetKey(leadMagnet!)
    const rows = leadMagnetReadinessRows(
      REQUIRED_LEAD_MAGNETS,
      new Map([
        [
          key,
          {
            id: 'lm_wrong',
            productId: 'prod_wrong',
            name: 'Wrong name',
            assetR2Bucket: 'wrong-bucket',
            assetR2Key: 'lead-magnets/wrong.pdf',
            fulfillmentSequenceSlug: 'wrong-sequence',
            conversionEventName: 'wrong_event',
          },
        ],
      ]),
    )

    const findings = buildReadinessFindings({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      sequenceSlugs: sequenceSlugMap(),
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: rows,
      retiredSequenceRows: 0,
    })

    expect(findings).toContain(`Lead magnet row mismatch: ${key} id`)
    expect(findings).toContain(`Lead magnet row mismatch: ${key} productId`)
    expect(findings).toContain(`Lead magnet row mismatch: ${key} name`)
    expect(findings).toContain(`Lead magnet row mismatch: ${key} assetR2Bucket`)
    expect(findings).toContain(`Lead magnet row mismatch: ${key} assetR2Key`)
    expect(findings).toContain(`Lead magnet row mismatch: ${key} fulfillmentSequenceSlug`)
    expect(findings).toContain(`Lead magnet row mismatch: ${key} conversionEventName`)
  })

  it('reports missing required lead magnet fulfillment sequences', () => {
    const leadMagnet = REQUIRED_LEAD_MAGNETS[0]
    expect(leadMagnet).toBeDefined()
    const slugs = sequenceSlugMap()
    slugs.get(leadMagnet!.productSlug)?.delete(leadMagnet!.fulfillmentSequenceSlug)

    const findings = buildReadinessFindings({
      secretNames: new Set(REQUIRED_PRODUCTION_SECRETS),
      productRows: new Set(LIVE_PRODUCTS.map((product) => product.slug)),
      sequenceCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      sequenceSlugs: slugs,
      tokenCounts: new Map(LIVE_PRODUCTS.map((product) => [product.slug, 1])),
      leadMagnetRows: leadMagnetReadinessRows(),
      retiredSequenceRows: 0,
    })

    expect(findings).toContain(
      `Missing lead magnet fulfillment sequence: ${leadMagnet!.productSlug}/${leadMagnet!.fulfillmentSequenceSlug}`,
    )
  })

  it('generates required lead magnet seed SQL', () => {
    const sql = buildRequiredLeadMagnetSeedSql()

    expect(sql).toContain('INSERT INTO seq_lead_magnets')
    expect(sql).toContain("'lm_camaudit_cam_reconciliation_checklist'")
    expect(sql).toContain("'prod_camaudit'")
    expect(sql).toContain("'cam-reconciliation-checklist'")
    expect(sql).toContain("'camaudit'")
    expect(sql).toContain("'guides/cam-reconciliation-audit-checklist.pdf'")
    expect(sql).toContain("'camaudit-cam-reconciliation-checklist'")
    expect(sql).not.toContain("'lease-abstraction-checklist'")
    expect(sql).not.toContain("'lease-extraction-checklist'")
    expect(sql).not.toContain("'streaming-savings-checklist'")
    expect(sql).not.toContain("'annual-club-calendar-template'")
    expect(sql).not.toContain("'skill-trade-tax-checklist'")
    expect(sql).not.toContain("'boardstack-lead-magnets'")
    expect(sql).not.toContain("'kaiplan-lead-magnets'")
    expect(sql).toContain('BEGIN TRANSACTION;')
    expect(sql).toContain('ON CONFLICT(slug) DO UPDATE SET')
    expect(sql).toContain('  id = excluded.id,')
    expect(sql).toContain(
      "UPDATE seq_lead_magnets\nSET active = 0\nWHERE product_id = 'prod_camaudit'",
    )
    expect(sql).toContain("  AND slug NOT IN ('abstract-to-audit-trigger-scorecard'")
    expect(sql).not.toContain('prod_gathergrove')
    expect(sql).not.toContain('cam-pre-send-packet-checklist')
    expect(sql).toContain('COMMIT;')
    for (const leadMagnet of REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS) {
      expect(sql).toContain(`'${leadMagnet.id}'`)
      expect(sql).toContain(`'${leadMagnet.productId}'`)
      expect(sql).toContain(`'${leadMagnet.slug}'`)
      expect(sql).toContain(`'${leadMagnet.assetR2Bucket}'`)
      expect(sql).toContain(`'${leadMagnet.assetR2Key}'`)
      expect(sql).toContain(`'${leadMagnet.fulfillmentSequenceSlug}'`)
      expect(sql).toContain(`'${leadMagnet.conversionEventName}'`)
    }
    expect([...sql.matchAll(/\('lm_/g)]).toHaveLength(REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.length)
  })

  it('escapes SQL string values in generated seed SQL', () => {
    const sql = buildRequiredLeadMagnetSeedSql([
      {
        productSlug: 'camaudit',
        productId: 'prod_camaudit',
        id: 'lm_camaudit_quote_test',
        slug: 'quote-test',
        name: "Tenant's CAM Checklist",
        assetR2Bucket: 'camaudit',
        assetR2Key: "lead-magnets/tenant's-checklist.pdf",
        fulfillmentSequenceSlug: 'camaudit-lead-magnet-tenant-checklist',
        conversionEventName: 'quote_test_downloaded',
        fulfillmentOwner: 'sequencer',
      },
    ])

    expect(sql).toContain("'Tenant''s CAM Checklist'")
    expect(sql).toContain("'lead-magnets/tenant''s-checklist.pdf'")
  })

  it('generates valid retirement SQL for product-owned-only manifests with a live product', () => {
    const sql = buildRequiredLeadMagnetSeedSql([
      {
        productSlug: 'floriva-web',
        productId: 'prod_floriva_web',
        id: 'lm_floriva_web_product_owned_test',
        slug: 'product-owned-test',
        name: 'Product Owned Test',
        assetR2Bucket: null,
        assetR2Key: null,
        fulfillmentSequenceSlug: 'floriva-web-lead-magnet-nurture',
        conversionEventName: 'product_owned_test_downloaded',
        fulfillmentOwner: 'product',
      },
    ])

    expect(sql).toBe(
      [
        'BEGIN TRANSACTION;',
        'UPDATE seq_lead_magnets',
        'SET active = 0',
        "WHERE product_id = 'prod_floriva_web';",
        'COMMIT;',
      ].join('\n'),
    )
  })

  it('generates safe verification commands for every product-owned lead magnet asset', () => {
    const plan = buildRequiredLeadMagnetAssetUploadPlan()
    const expectedLines = [
      "$ErrorActionPreference = 'Stop'",
      '$tempRoot = Join-Path $env:TEMP "sequencer-lead-magnet-verification"',
      'New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null',
      ...REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.flatMap((leadMagnet) => {
        const variableName = `${leadMagnet.productSlug}_${leadMagnet.slug}`.replace(
          /[^a-z0-9]/g,
          '_',
        )
        return [
          `$${variableName} = Join-Path $tempRoot '${leadMagnet.productSlug}-${leadMagnet.slug}'`,
          `pnpm exec wrangler r2 object get '${leadMagnet.assetR2Bucket}/${leadMagnet.assetR2Key}' --remote --config 'apps/api/wrangler.toml' --file $${variableName}`,
          `if (-not (Test-Path -LiteralPath $${variableName} -PathType Leaf)) { throw "Missing lead magnet asset file: $${variableName}" }`,
        ]
      }),
    ]

    expect(plan).toContain(
      "pnpm exec wrangler r2 object get 'camaudit/guides/cam-reconciliation-audit-checklist.pdf'",
    )
    expect(plan).toContain(
      "pnpm exec wrangler r2 object get 'camaudit/guides/cpa-service-line-roi-playbook.pdf'",
    )
    expect(plan).toContain(
      "pnpm exec wrangler r2 object get 'camaudit/guides/tenant-rep-cam-audit-proposal-template.pdf'",
    )
    expect(plan).not.toContain('grantpipe-documents')
    expect(plan).not.toContain('sequencer-assets')
    expect(plan).not.toContain('TODO_LOCAL_PATH')
    expect(plan).not.toContain('geoleap')
    expect(plan).not.toContain('gathergrove')
    expect(plan).not.toContain('boardstack')
    expect(plan).not.toContain('kaiplan')
    expect(plan).not.toContain('pebbledesk')
    expect(plan).not.toContain('phiguard')
    expect(plan).not.toContain('skillledger')
    expect(plan).not.toContain('<')
    expect(plan).not.toContain('>')
    expect(plan.split('\n')).toEqual(expectedLines)
  })

  it('quotes generated PowerShell asset paths so metacharacters stay data', () => {
    const plan = buildRequiredLeadMagnetAssetUploadPlan([
      {
        productSlug: 'camaudit"; throw "pwned',
        productId: 'prod_camaudit',
        id: 'lm_camaudit_injection_test',
        slug: "injection-test'; throw 'pwned",
        name: 'Injection test',
        assetR2Bucket: 'camaudit',
        assetR2Key: "lead-magnets/a.pdf'; throw 'pwned",
        fulfillmentSequenceSlug: 'camaudit-lead-magnet-tenant-checklist',
        conversionEventName: 'injection_test_downloaded',
        fulfillmentOwner: 'sequencer',
      },
    ])

    expect(plan).toContain(
      "$camaudit___throw__pwned_injection_test___throw__pwned = Join-Path $tempRoot 'camaudit\"; throw \"pwned-injection-test''; throw ''pwned'",
    )
    expect(plan).toContain(
      "pnpm exec wrangler r2 object get 'camaudit/lead-magnets/a.pdf''; throw ''pwned'",
    )
    expect(plan).not.toContain('Join-Path $tempRoot "camaudit')
    expect(plan).not.toContain("a.pdf'; throw 'pwned --remote")
  })

  it('probes remote R2 assets only for Sequencer-managed lead magnets', () => {
    const assetKeys = requiredRemoteLeadMagnetAssetKeys()

    expect(assetKeys).toEqual(
      REQUIRED_SEQUENCER_HOSTED_LEAD_MAGNETS.map((leadMagnet) => ({
        bucket: leadMagnet.assetR2Bucket,
        key: leadMagnet.assetR2Key,
      })),
    )
    expect(assetKeys).not.toContain(null)
    expect(assetKeys).not.toContain('null')
    expect(assetKeys).not.toContain(undefined)
  })

  it('generates seq_api_tokens seed SQL for every live product', () => {
    const sql = buildApiTokenSeedSql()

    expect(sql).toContain("'tok_floriva_web_prod'")
    expect(sql).toContain("'prod_floriva_web'")
    expect(sql).toContain("'<access_client_id_for_floriva_web>'")
    expect(sql).not.toContain("'tok_grantpipe_prod'")
    expect(sql).not.toContain("'tok_kaiplan_prod'")
    expect(sql).not.toContain('reachally')
    expect(sql).not.toContain('a11yproof')
  })

  it('generates seq_api_tokens seed SQL from a filled Access service-token template', () => {
    const template = Object.fromEntries(
      LIVE_PRODUCTS.map((product, index) => [
        product.slug,
        { access_client_id: `${String(index + 1).padStart(32, '0')}.access` },
      ]),
    )
    const sql = buildApiTokenSeedSql(parseAccessServiceTokenTemplate(JSON.stringify(template)))

    expect(sql).toContain("'00000000000000000000000000000002.access'")
    expect(sql).not.toContain("'00000000000000000000000000000003.access'")
    expect(sql).not.toContain("'00000000000000000000000000000004.access'")
    expect(sql).not.toContain('<access_client_id_for_')
  })

  it('parses Access service-token templates with a UTF-8 BOM', () => {
    const template = Object.fromEntries(
      LIVE_PRODUCTS.map((product, index) => [
        product.slug,
        { access_client_id: `${String(index + 1).padStart(32, '0')}.access` },
      ]),
    )
    const serviceTokenIds = parseAccessServiceTokenTemplate(`\uFEFF${JSON.stringify(template)}`)

    expect(serviceTokenIds.get('floriva-web')).toBe('00000000000000000000000000000002.access')
  })

  it('accepts the legacy service_token_id field and rejects unexpected products', () => {
    const template = Object.fromEntries(
      LIVE_PRODUCTS.map((product, index) => [
        product.slug,
        { service_token_id: `${String(index + 1).padStart(32, '0')}.access` },
      ]),
    )

    expect(parseAccessServiceTokenTemplate(JSON.stringify(template)).get('camaudit')).toBe(
      '00000000000000000000000000000001.access',
    )
    expect(() =>
      parseAccessServiceTokenTemplate(JSON.stringify({ ...template, grantpipe: {} })),
    ).toThrow('Unexpected product in Access token template: grantpipe')
  })

  it('rejects duplicate Access service-token ids across products', () => {
    const template = Object.fromEntries(
      LIVE_PRODUCTS.map((product, index) => [
        product.slug,
        { access_client_id: `${String(index + 1).padStart(32, '0')}.access` },
      ]),
    )
    template['floriva-web'].access_client_id = template.camaudit.access_client_id

    expect(() => parseAccessServiceTokenTemplate(JSON.stringify(template))).toThrow(
      'Duplicate service_token_id for products: camaudit, floriva-web',
    )
  })

  it('rejects Access service-token templates that still contain placeholders', () => {
    const template = JSON.parse(buildAccessServiceTokenTemplateJson())

    expect(() => parseAccessServiceTokenTemplate(JSON.stringify(template))).toThrow(
      LIVE_PRODUCTS.map(
        (product) => `Missing real access_client_id for product: ${product.slug}`,
      ).join('\n'),
    )
  })

  it('rejects Access service-token templates with non-client-id subjects', () => {
    const template = Object.fromEntries(
      LIVE_PRODUCTS.map((product, index) => [
        product.slug,
        { access_client_id: `${String(index + 1).padStart(32, '0')}.access` },
      ]),
    )
    template.camaudit.access_client_id = 'not-a-token-id'

    expect(() => parseAccessServiceTokenTemplate(JSON.stringify(template))).toThrow(
      'Missing real access_client_id for product: camaudit',
    )
  })

  it('generates an Access service-token id collection template for every live product', () => {
    const template = JSON.parse(buildAccessServiceTokenTemplateJson()) as Record<
      string,
      {
        product_id: string
        access_client_id: string
        cloudflare_service_token_name: string
        access_client_id_env: string
        access_client_secret_env: string
        note: string
      }
    >

    expect(template['floriva-web']).toMatchObject({
      product_id: 'prod_floriva_web',
      cloudflare_service_token_name: 'floriva-web-service-token',
      access_client_id: '<access_client_id_for_floriva_web>',
      access_client_id_env: 'SEQUENCER_CF_ACCESS_CLIENT_ID',
      access_client_secret_env: 'SEQUENCER_CF_ACCESS_CLIENT_SECRET',
    })
    expect(template['floriva-web'].note).toContain('verified Access service-token client id')
    expect(Object.keys(template)).not.toContain('reachally')
    expect(Object.keys(template)).not.toContain('a11yproof')
  })

  it('generates a Wrangler secret bulk template for every required secret', () => {
    const template = JSON.parse(buildSecretTemplateJson()) as Record<string, string>

    expect(template.RESEND_WEBHOOK_SECRET).toBe('<RESEND_WEBHOOK_SECRET>')
    expect(template.SENTRY_DSN).toBe('<SENTRY_DSN>')
    expect(template.RESEND_API_KEY_FLORIVA_WEB).toBe('<RESEND_API_KEY_FLORIVA_WEB>')
    expect(Object.keys(template)).not.toContain('RESEND_API_KEY_GRANTPIPE')
    expect(Object.keys(template)).not.toContain('RESEND_API_KEY_KAIPLAN')
    expect(Object.keys(template)).not.toContain('RESEND_API_KEY_REACHALLY')
    expect(Object.keys(template)).not.toContain('RESEND_API_KEY_A11YPROOF')
  })

  it('generates a Wrangler secret bulk template for a subset of secrets', () => {
    const template = JSON.parse(
      buildSecretTemplateJson(['INSTANTLY_API_KEY', 'RESEND_API_KEY_FLORIVA_WEB']),
    ) as Record<string, string>

    expect(template).toEqual({
      INSTANTLY_API_KEY: '<INSTANTLY_API_KEY>',
      RESEND_API_KEY_FLORIVA_WEB: '<RESEND_API_KEY_FLORIVA_WEB>',
    })
  })

  it('parses Wrangler JSON output even when warnings precede the payload', () => {
    const rows = parseWranglerJsonOutput<{ slug: string }>(
      [
        'wrangler warning: update available',
        '[not json]',
        JSON.stringify([{ results: [{ slug: 'camaudit' }], success: true }]),
      ].join('\n'),
    )

    expect(rows).toEqual([{ slug: 'camaudit' }])
  })

  it('returns empty collections for malformed Wrangler JSON and secret output', () => {
    expect(parseWranglerJsonOutput('warning\n[not json]')).toEqual([])
    expect(parseWranglerSecretListOutput('warning\n[not json]')).toEqual([])
    expect(parseWranglerSecretListOutput('warning\n{"name":"not-an-array"}')).toEqual([])
  })
})
