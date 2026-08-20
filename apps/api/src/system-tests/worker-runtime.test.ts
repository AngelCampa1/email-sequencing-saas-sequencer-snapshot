/// <reference types="@cloudflare/vitest-pool-workers" />
import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  env,
  fetchMock,
  runDurableObjectAlarm,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { verifyAccessJwtPayload } from '../lib/access'

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    ASSETS_BUCKET: R2Bucket
    FLORIVA_LEAD_MAGNETS: R2Bucket
    DB: D1Database
    LOGS_BUCKET: R2Bucket
    SEQUENCE_RUN: DurableObjectNamespace
    SESSIONS: KVNamespace
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
  }
}

const productId = 'prod-system-camaudit'
const accessClientId = 'system-camaudit.access'
const issuer = 'https://sequencer-system-test.cloudflareaccess.com'
let accessJwt: string
let dashboardAccessJwt: string
let forbiddenDashboardAccessJwt: string
let signAccessJwtWithTestKey: ((claims: Record<string, unknown>) => Promise<string>) | null = null

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await installAccessJwtSigner()
  accessJwt = await createAccessJwt({
    common_name: accessClientId,
    service_token_id: accessClientId,
  })
  dashboardAccessJwt = await createAccessJwt({ email: 'operator@example.com' })
  forbiddenDashboardAccessJwt = await createAccessJwt({ email: 'outsider@example.com' })
})

describe('worker runtime system harness', () => {
  it('serves the health endpoint inside the Workers runtime', async () => {
    const response = await SELF.fetch('https://sequencer.test/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      env: 'development',
    })
  })

  it('creates a contact and enrollment through the Worker with a real Durable Object start', async () => {
    const enrollment = await createSystemEnrollment('runtime-contact@example.com')

    const runRow = await env.DB.prepare(`
      SELECT status, contact_id, product_id, sequence_slug
      FROM seq_sequence_runs
      WHERE id = ?
    `)
      .bind(enrollment.run_id)
      .first()
    expect(runRow).toMatchObject({
      status: 'running',
      product_id: productId,
      sequence_slug: 'system-welcome',
    })

    const doId = env.SEQUENCE_RUN.idFromName(enrollment.run_id)
    const statusResponse = await env.SEQUENCE_RUN.get(doId).fetch('https://do/status')
    expect(statusResponse.status).toBe(200)
    await expect(statusResponse.json()).resolves.toMatchObject({
      runId: enrollment.run_id,
      contactEmail: 'runtime-contact@example.com',
      productId,
      productSlug: 'camaudit',
      sequenceSlug: 'system-welcome',
      status: 'running',
    })
  })

  it('serves internal overview only to allowed dashboard Access users in the Worker runtime', async () => {
    await seedProductSequence()

    const forbiddenResponse = await SELF.fetch('https://sequencer.test/api/internal/overview', {
      headers: dashboardHeaders(forbiddenDashboardAccessJwt),
    })
    expect(forbiddenResponse.status).toBe(403)

    const response = await SELF.fetch('https://sequencer.test/api/internal/overview', {
      headers: dashboardHeaders(),
    })

    expect(response.status).toBe(200)
    const overview = (await response.json()) as {
      active_runs: number
      top_sequences: Array<{ slug: string; product: string; enrollments: number }>
      rot_sequences: string[]
    }
    expect(overview.active_runs).toBeGreaterThanOrEqual(0)
    expect(overview.top_sequences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'system-welcome',
          product: 'camaudit',
        }),
      ]),
    )
  })

  it('creates and lists internal lead magnets against real D1, R2, and audit bindings', async () => {
    await seedProductSequence()
    await env.ASSETS_BUCKET.put('lead-magnets/admin-system.pdf', 'admin system asset', {
      httpMetadata: { contentType: 'application/pdf' },
    })

    const createResponse = await SELF.fetch('https://sequencer.test/api/internal/lead-magnets', {
      method: 'POST',
      headers: dashboardHeaders(),
      body: JSON.stringify({
        product_id: productId,
        slug: 'system-admin-guide',
        name: 'System Admin Guide',
        asset_r2_bucket: 'sequencer-assets',
        asset_r2_key: 'lead-magnets/admin-system.pdf',
        fulfillment_sequence_slug: 'system-welcome',
        conversion_event_name: 'admin_downloaded',
        active: true,
      }),
    })

    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      id: string
      slug: string
      asset_status: string
    }
    expect(created).toMatchObject({
      slug: 'system-admin-guide',
      asset_status: 'available',
    })

    const row = await env.DB.prepare(`
      SELECT slug, asset_r2_bucket, fulfillment_sequence_slug, conversion_event_name
      FROM seq_lead_magnets
      WHERE id = ?
    `)
      .bind(created.id)
      .first()
    expect(row).toMatchObject({
      slug: 'system-admin-guide',
      asset_r2_bucket: 'sequencer-assets',
      fulfillment_sequence_slug: 'system-welcome',
      conversion_event_name: 'admin_downloaded',
    })

    const listResponse = await SELF.fetch('https://sequencer.test/api/internal/lead-magnets', {
      headers: dashboardHeaders(),
    })
    expect(listResponse.status).toBe(200)
    const leadMagnets = (await listResponse.json()) as Array<{ slug: string; asset_status: string }>
    expect(leadMagnets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'system-admin-guide',
          asset_status: 'available',
        }),
      ]),
    )

    const auditRow = await env.DB.prepare(`
      SELECT actor, action, target_type, target_id
      FROM seq_audit_log
      WHERE action = 'lead_magnet.created'
        AND target_id = ?
      LIMIT 1
    `)
      .bind(created.id)
      .first()
    expect(auditRow).toMatchObject({
      actor: 'operator@example.com',
      action: 'lead_magnet.created',
      target_type: 'lead_magnet',
      target_id: created.id,
    })
  })

  it('renders internal template previews through Worker routing and the real renderer', async () => {
    await seedProductSequence()

    const response = await SELF.fetch(
      'https://sequencer.test/api/internal/templates/lead-magnets%2Ftenant-checklist-delivery/preview?product=camaudit&sequence=system-welcome',
      {
        headers: dashboardHeaders(),
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('/unsubscribe?')
    expect(html).toContain('email=preview%40example.com')
    expect(html).toContain('product=camaudit')
    expect(html).toContain('sig=')
  })

  it('downloads a lead magnet, starts fulfillment, stores source attribution, and streams the R2 asset', async () => {
    await seedProductSequence()
    await seedLeadMagnet()
    await env.ASSETS_BUCKET.put('lead-magnets/system.pdf', 'system asset', {
      httpMetadata: { contentType: 'application/pdf' },
    })

    const downloadResponse = await SELF.fetch(
      'https://sequencer.test/api/v1/lead-magnets/system-guide/download',
      {
        method: 'POST',
        headers: productApiHeaders(),
        body: JSON.stringify({
          email: 'runtime-magnet@example.com',
          first_name: 'Magnet',
          source: 'system-test-form',
          utm: { campaign: 'system' },
        }),
      },
    )

    expect(downloadResponse.status).toBe(200)
    const download = (await downloadResponse.json()) as {
      ok: boolean
      asset_url: string
      run_id: string
      status: string
    }
    expect(download).toMatchObject({
      ok: true,
      run_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'enrolled',
    })
    expect(download.asset_url).toMatch(
      /^https:\/\/sequencer\.test\/assets\/lead-magnets\/system-guide\?token=/,
    )

    const sourceRow = await env.DB.prepare(`
      SELECT cs.source, cs.utm, lm.slug AS lead_magnet_slug, p.slug AS product_slug
      FROM seq_contact_sources cs
      INNER JOIN seq_lead_magnets lm ON lm.id = cs.lead_magnet_id
      INNER JOIN seq_products p ON p.id = cs.product_id
      INNER JOIN seq_contacts c ON c.id = cs.contact_id
      WHERE c.email = ?
      ORDER BY cs.captured_at DESC
      LIMIT 1
    `)
      .bind('runtime-magnet@example.com')
      .first<{
        source: string
        utm: string
        lead_magnet_slug: string
        product_slug: string
      }>()
    expect(sourceRow).toMatchObject({
      source: 'system-test-form',
      lead_magnet_slug: 'system-guide',
      product_slug: 'camaudit',
    })
    expect(JSON.parse(sourceRow?.utm ?? '{}')).toEqual({ campaign: 'system' })

    const doStatus = await env.SEQUENCE_RUN.get(env.SEQUENCE_RUN.idFromName(download.run_id)).fetch(
      'https://do/status',
    )
    await expect(doStatus.json()).resolves.toMatchObject({
      runId: download.run_id,
      contactEmail: 'runtime-magnet@example.com',
      sequenceSlug: 'system-welcome',
      status: 'running',
    })

    const assetResponse = await SELF.fetch(download.asset_url)
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('content-type')).toBe('application/pdf')
    expect(assetResponse.headers.get('cache-control')).toBe('private, max-age=0, no-store')
    await expect(assetResponse.text()).resolves.toBe('system asset')
  })

  it('streams lead magnet assets from a product-owned R2 bucket in the Worker runtime', async () => {
    await seedProductSequence()
    await seedLeadMagnet({
      id: 'lm-system-product-bucket',
      slug: 'system-product-guide',
      assetR2Bucket: 'floriva-lead-magnets',
      assetR2Key: 'lead-magnets/product-owned.pdf',
    })
    await env.FLORIVA_LEAD_MAGNETS.put('lead-magnets/product-owned.pdf', 'product bucket asset', {
      httpMetadata: { contentType: 'application/pdf' },
    })

    const downloadResponse = await SELF.fetch(
      'https://sequencer.test/api/v1/lead-magnets/system-product-guide/download',
      {
        method: 'POST',
        headers: productApiHeaders(),
        body: JSON.stringify({
          email: 'runtime-product-bucket@example.com',
          first_name: 'Bucket',
        }),
      },
    )

    expect(downloadResponse.status).toBe(200)
    const download = (await downloadResponse.json()) as { ok: boolean; asset_url: string }
    expect(download.ok).toBe(true)

    const assetResponse = await SELF.fetch(download.asset_url)
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('content-type')).toBe('application/pdf')
    await expect(assetResponse.text()).resolves.toBe('product bucket asset')
  })

  it('persists and delivers a lead magnet conversion event to active same-product runs', async () => {
    await seedProductSequence({ exitConditions: [{ event: 'lead_magnet_downloaded' }] })
    await seedLeadMagnet({
      id: 'lm-system-conversion',
      slug: 'system-conversion-guide',
      conversionEventName: 'lead_magnet_downloaded',
    })
    await env.ASSETS_BUCKET.put('lead-magnets/system.pdf', 'conversion asset', {
      httpMetadata: { contentType: 'application/pdf' },
    })

    const downloadResponse = await SELF.fetch(
      'https://sequencer.test/api/v1/lead-magnets/system-conversion-guide/download',
      {
        method: 'POST',
        headers: productApiHeaders(),
        body: JSON.stringify({
          email: 'runtime-conversion@example.com',
          first_name: 'Convert',
          source: 'conversion-system-test',
          utm: { content: 'runtime' },
        }),
      },
    )

    expect(downloadResponse.status).toBe(200)
    const download = (await downloadResponse.json()) as {
      ok: boolean
      run_id: string
      asset_url: string
    }
    expect(download.ok).toBe(true)

    const eventRow = await env.DB.prepare(`
      SELECT type, json_extract(payload, '$.email') AS email, json_extract(payload, '$.lead_magnet_slug') AS lead_magnet_slug
      FROM seq_events
      WHERE provider = 'internal'
        AND type = 'lead_magnet_downloaded'
        AND json_extract(payload, '$.email') = ?
      ORDER BY id DESC
      LIMIT 1
    `)
      .bind('runtime-conversion@example.com')
      .first<{
        type: string
        email: string
        lead_magnet_slug: string
      }>()
    expect(eventRow).toMatchObject({
      type: 'lead_magnet_downloaded',
      email: 'runtime-conversion@example.com',
      lead_magnet_slug: 'system-conversion-guide',
    })

    const runRow = await env.DB.prepare(`
      SELECT status, completed_at
      FROM seq_sequence_runs
      WHERE id = ?
    `)
      .bind(download.run_id)
      .first<{ status: string; completed_at: string | null }>()
    expect(runRow).toMatchObject({
      status: 'exited',
      completed_at: expect.any(String),
    })
  })

  it('runs a scheduled Durable Object alarm and persists sent email artifacts', async () => {
    let resendIdempotencyKey: string | null = null
    let resendPayload: Record<string, unknown> | null = null
    fetchMock
      .get('https://api.resend.com')
      .intercept({
        method: 'POST',
        path: '/emails',
        headers: (headers: Record<string, string>) => {
          resendIdempotencyKey = headerValue(headers, 'idempotency-key')
          return true
        },
        body: (body: string) => {
          resendPayload = JSON.parse(body) as Record<string, unknown>
          return true
        },
      })
      .reply(200, { id: 'resend-system-alarm' })

    const enrollment = await createSystemEnrollment('runtime-alarm@example.com')
    await setContactSendWindowTimeZone('runtime-alarm@example.com')
    const stub = env.SEQUENCE_RUN.get(env.SEQUENCE_RUN.idFromName(enrollment.run_id))

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true)
    expect(resendIdempotencyKey).toBe(`sequencer:${enrollment.run_id}:0`)
    expect(resendPayload).toMatchObject({
      to: 'runtime-alarm@example.com',
      from: 'CAMAudit <hello@example.com>',
      subject: 'Welcome',
      tags: expect.arrayContaining([
        { name: 'sequence', value: 'system-welcome' },
        { name: 'step', value: 'intro' },
        { name: 'product', value: 'camaudit' },
        { name: 'run_id', value: enrollment.run_id },
      ]),
    })

    const runRow = await env.DB.prepare(`
      SELECT status, current_step_index, completed_at
      FROM seq_sequence_runs
      WHERE id = ?
    `)
      .bind(enrollment.run_id)
      .first<{
        status: string
        current_step_index: number
        completed_at: string | null
      }>()
    expect(runRow).toMatchObject({
      status: 'completed',
      current_step_index: 1,
      completed_at: expect.any(String),
    })

    const stepRow = await env.DB.prepare(`
      SELECT status, message_id, template_slug, sent_at
      FROM seq_steps
      WHERE run_id = ? AND step_index = 0
    `)
      .bind(enrollment.run_id)
      .first<{
        status: string
        message_id: string | null
        template_slug: string
        sent_at: string | null
      }>()
    expect(stepRow).toMatchObject({
      status: 'sent',
      message_id: 'resend-system-alarm',
      template_slug: 'lead-magnets/tenant-checklist-delivery',
      sent_at: expect.any(String),
    })

    const messageRow = await env.DB.prepare(`
      SELECT resend_message_id, subject, from_email, html_r2_key, sent_at
      FROM seq_messages
      WHERE resend_message_id = 'resend-system-alarm'
    `).first<{
      resend_message_id: string
      subject: string
      from_email: string
      html_r2_key: string | null
      sent_at: string | null
    }>()
    expect(messageRow).toMatchObject({
      resend_message_id: 'resend-system-alarm',
      subject: 'Welcome',
      from_email: 'CAMAudit <hello@example.com>',
      html_r2_key: expect.stringContaining(
        `emails/camaudit/system-welcome/${enrollment.run_id}/0-resend-system-alarm.html`,
      ),
      sent_at: expect.any(String),
    })

    const archivedHtml = await env.LOGS_BUCKET.get(messageRow?.html_r2_key ?? '')
    expect(archivedHtml).not.toBeNull()
    await expect(archivedHtml?.text()).resolves.toContain('email=runtime-alarm%40example.com')
  })

  it('processes a Resend delivery queue event through the exported Worker queue handler and D1', async () => {
    await seedProductSequence()
    await env.DB.prepare(`
      INSERT OR REPLACE INTO seq_contacts (
        id,
        email,
        first_name
      )
      VALUES ('contact-system-delivery', 'runtime-queue@example.com', 'Queue')
    `).run()

    await env.DB.prepare(`
      INSERT INTO seq_steps (
        id,
        run_id,
        step_index,
        scheduled_for,
        sent_at,
        message_id,
        template_slug,
        status
      )
      VALUES ('step-system-delivery', 'run-system-delivery', 0, ?, ?, 'msg-system-delivery', 'welcome', 'sent')
    `)
      .bind(new Date().toISOString(), new Date().toISOString())
      .run()
    await env.DB.prepare(`
      INSERT INTO seq_messages (
        id,
        step_id,
        contact_id,
        product_id,
        resend_message_id,
        subject,
        from_email,
        sent_at
      )
      VALUES (
        'msg-system-delivery',
        'step-system-delivery',
        ?,
        ?,
        'resend-system-delivery',
        'Welcome',
        'hello@example.com',
        ?
      )
    `)
      .bind('contact-system-delivery', productId, new Date().toISOString())
      .run()

    const ack = vi.fn()
    const retry = vi.fn()
    await worker.queue?.(
      {
        queue: 'events-queue',
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.delivered',
              event_id: 'evt-system-delivery',
              message_id: 'resend-system-delivery',
              payload: {
                email_id: 'resend-system-delivery',
              },
              received_at: '2026-05-27T01:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      env as never,
      {} as never,
    )

    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()

    const messageRow = await env.DB.prepare(`
      SELECT delivered_at
      FROM seq_messages
      WHERE id = 'msg-system-delivery'
    `).first<{ delivered_at: string | null }>()
    expect(messageRow?.delivered_at).toBe('2026-05-27T01:00:00.000Z')

    const eventRow = await env.DB.prepare(`
      SELECT type, provider_event_id, side_effects_completed_at
      FROM seq_events
      WHERE provider = 'resend' AND provider_event_id = 'evt-system-delivery'
    `).first<{
      type: string
      provider_event_id: string
      side_effects_completed_at: string | null
    }>()
    expect(eventRow).toMatchObject({
      type: 'email.delivered',
      provider_event_id: 'evt-system-delivery',
      side_effects_completed_at: expect.any(String),
    })
  })

  it('marks a completed final-step run errored when Resend later reports send failure', async () => {
    fetchMock
      .get('https://api.resend.com')
      .intercept({
        method: 'POST',
        path: '/emails',
      })
      .reply(200, { id: 'resend-system-final-failed' })

    const enrollment = await createSystemEnrollment('runtime-final-failed@example.com')
    await setContactSendWindowTimeZone('runtime-final-failed@example.com')
    const stub = env.SEQUENCE_RUN.get(env.SEQUENCE_RUN.idFromName(enrollment.run_id))
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true)

    const completedRun = await env.DB.prepare(`
      SELECT status
      FROM seq_sequence_runs
      WHERE id = ?
    `)
      .bind(enrollment.run_id)
      .first<{ status: string }>()
    expect(completedRun?.status).toBe('completed')

    const ack = vi.fn()
    const retry = vi.fn()
    await worker.queue?.(
      {
        queue: 'events-queue',
        messages: [
          {
            body: {
              provider: 'resend',
              event_type: 'email.failed',
              event_id: 'evt-system-final-failed',
              message_id: 'resend-system-final-failed',
              payload: {
                data: {
                  email_id: 'resend-system-final-failed',
                  failed: {
                    reason: 'domain_not_verified',
                    message: 'Domain is not verified',
                  },
                },
              },
              received_at: '2026-05-27T02:00:00.000Z',
            },
            ack,
            retry,
          },
        ],
      } as never,
      env as never,
      {} as never,
    )

    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()

    const failedRun = await env.DB.prepare(`
      SELECT status, completed_at
      FROM seq_sequence_runs
      WHERE id = ?
    `)
      .bind(enrollment.run_id)
      .first<{ status: string; completed_at: string | null }>()
    expect(failedRun).toMatchObject({
      status: 'errored',
      completed_at: '2026-05-27T02:00:00.000Z',
    })

    const failedStep = await env.DB.prepare(`
      SELECT status, error
      FROM seq_steps
      WHERE run_id = ? AND step_index = 0
    `)
      .bind(enrollment.run_id)
      .first<{ status: string; error: string | null }>()
    expect(failedStep).toMatchObject({
      status: 'failed',
      error: 'domain_not_verified: Domain is not verified',
    })

    const failedMessage = await env.DB.prepare(`
      SELECT failed_at, failure_reason
      FROM seq_messages
      WHERE resend_message_id = 'resend-system-final-failed'
    `).first<{ failed_at: string | null; failure_reason: string | null }>()
    expect(failedMessage).toMatchObject({
      failed_at: '2026-05-27T02:00:00.000Z',
      failure_reason: 'domain_not_verified: Domain is not verified',
    })
  })

  it('accepts an authenticated Instantly webhook through Worker ingress', async () => {
    await seedProductSequence()
    await env.DB.prepare(`
      INSERT OR REPLACE INTO seq_instantly_campaigns (id, name, status, product_id)
      VALUES ('campaign-system-webhook', 'System webhook campaign', 'active', ?)
    `)
      .bind(productId)
      .run()

    const response = await SELF.fetch('https://sequencer.test/webhooks/instantly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-instantly-webhook-secret': 'system-instantly-secret',
      },
      body: JSON.stringify({
        event_type: 'reply_received',
        campaign_id: 'campaign-system-webhook',
        timestamp: '2026-05-27T01:00:00.000Z',
        lead_email: 'runtime-webhook@example.com',
        email_id: 'instantly-system-webhook',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('accepts an authenticated Resend webhook through Worker ingress', async () => {
    const payload = JSON.stringify({
      type: 'email.delivered',
      data: {
        email_id: 'resend-system-webhook',
      },
    })
    const messageId = 'evt-system-resend-webhook'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = await signResendWebhook(messageId, timestamp, payload)

    const response = await SELF.fetch('https://sequencer.test/webhooks/resend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
      body: payload,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('runs the exported scheduled D1 backup handler inside the Workers runtime', async () => {
    await seedProductSequence()
    const ctx = createExecutionContext()
    await worker.scheduled?.(createScheduledController({ cron: '0 4 * * *' }), env as never, ctx)
    await waitOnExecutionContext(ctx)

    const latest = await env.LOGS_BUCKET.get('backups/d1/latest.json')
    expect(latest).not.toBeNull()
    const manifest = JSON.parse(await latest!.text()) as {
      source: string
      tables: Record<string, { count: number; chunks: Array<{ key: string }> }>
    }
    expect(manifest.source).toBe('sequencer-db')
    expect(manifest.tables.seq_products.count).toBeGreaterThanOrEqual(1)
    const productChunkKey = manifest.tables.seq_products.chunks[0]?.key
    expect(productChunkKey).toMatch(/^backups\/d1\/.+\/seq_products\/000001\.json$/)

    const productChunk = await env.LOGS_BUCKET.get(productChunkKey)
    expect(productChunk).not.toBeNull()
    await expect(productChunk!.json()).resolves.toMatchObject({
      table: 'seq_products',
      rows: expect.arrayContaining([expect.objectContaining({ id: productId, slug: 'camaudit' })]),
    })
  })
})

async function createSystemEnrollment(email: string): Promise<{ run_id: string; status: string }> {
  await seedProductSequence()
  const tokenRow = await env.DB.prepare(`
      SELECT p.slug
      FROM seq_api_tokens t
      INNER JOIN seq_products p ON p.id = t.product_id
      WHERE t.access_service_token_id = ?
    `)
    .bind(accessClientId)
    .first()
  expect(tokenRow).toMatchObject({ slug: 'camaudit' })

  await expect(
    verifyAccessJwtPayload(accessJwt, {
      CF_ACCESS_TEAM_NAME: 'sequencer-system-test',
      CF_ACCESS_AUD: 'sequencer-system-test-aud',
    }),
  ).resolves.toMatchObject({
    service_token_id: accessClientId,
  })

  const contactResponse = await SELF.fetch('https://sequencer.test/api/v1/contacts', {
    method: 'POST',
    headers: productApiHeaders(),
    body: JSON.stringify({
      email,
      first_name: 'Runtime',
      product: 'camaudit',
    }),
  })

  if (contactResponse.status !== 201) {
    throw new Error(
      `contact upsert failed: ${contactResponse.status} ${await contactResponse.text()}`,
    )
  }
  await expect(contactResponse.json()).resolves.toMatchObject({
    email,
    is_new: true,
  })

  const enrollmentResponse = await SELF.fetch('https://sequencer.test/api/v1/enrollments', {
    method: 'POST',
    headers: productApiHeaders(),
    body: JSON.stringify({
      email,
      sequence_slug: 'system-welcome',
      source: 'system-test',
    }),
  })

  expect(enrollmentResponse.status).toBe(201)
  const enrollment = (await enrollmentResponse.json()) as { run_id: string; status: string }
  expect(enrollment.status).toBe('enrolled')
  expect(enrollment.run_id).toMatch(/^[0-9a-f-]{36}$/)
  return enrollment
}

// Returns a fixed-offset IANA zone where the current local time is about noon,
// safely inside the 08:00-17:00 send window. Computed from real time so it stays
// valid whenever the suite runs, without mocking Date.now (the Workers test pool
// relies on the real clock for isolated-storage bookkeeping).
function inSendWindowTimeZone(): string {
  const offsetHours = 12 - new Date().getUTCHours()
  if (offsetHours === 0) return 'UTC'
  // IANA Etc/GMT signs are inverted: UTC+N is written 'Etc/GMT-N'.
  return offsetHours > 0 ? `Etc/GMT-${offsetHours}` : `Etc/GMT+${-offsetHours}`
}

// Pins the seeded contact into the send window so the DO sends instead of deferring.
async function setContactSendWindowTimeZone(email: string): Promise<void> {
  await env.DB.prepare(`
      UPDATE seq_contacts
      SET properties = json_set(COALESCE(properties, '{}'), '$.timezone', ?)
      WHERE email = ?
    `)
    .bind(inSendWindowTimeZone(), email)
    .run()
}

async function seedProductSequence(
  options: { exitConditions?: Array<{ event: string }> } = {},
): Promise<void> {
  const exitConditions = options.exitConditions ?? [{ event: 'replied' }]
  await env.DB.prepare(`
      INSERT OR REPLACE INTO seq_products (
        id,
        slug,
        name,
        brand_color,
        default_from_email,
        default_reply_to,
        resend_api_key_secret_name,
        suppression_scope
      )
      VALUES (?, 'camaudit', 'CAMAudit', '#2563eb', 'CAMAudit <hello@example.com>', 'hello@example.com', 'RESEND_API_KEY_CAMAUDIT', 'product')
    `)
    .bind(productId)
    .run()
  await env.DB.prepare(`
      INSERT OR REPLACE INTO seq_api_tokens (
        id,
        product_id,
        label,
        access_service_token_id
      )
      VALUES ('tok-system-camaudit', ?, 'System test token', ?)
    `)
    .bind(productId, accessClientId)
    .run()
  await env.DB.prepare(`
      INSERT OR REPLACE INTO seq_sequences (
        slug,
        product_id,
        version,
        definition,
        goal,
        exit_conditions,
        is_active,
        compiled_from_sha
      )
      VALUES (?, ?, 1, ?, 'system-test', ?, 1, 'system-test')
    `)
    .bind(
      'system-welcome',
      productId,
      JSON.stringify({
        slug: 'system-welcome',
        product: 'camaudit',
        version: 1,
        exit_conditions: exitConditions,
        steps: [
          {
            id: 'intro',
            delay: '1h',
            template: 'lead-magnets/tenant-checklist-delivery',
            subject: 'Welcome',
          },
        ],
      }),
      JSON.stringify(exitConditions),
    )
    .run()
}

async function seedLeadMagnet(
  options: {
    id?: string
    slug?: string
    assetR2Bucket?: string
    assetR2Key?: string
    conversionEventName?: string | null
  } = {},
): Promise<void> {
  await env.DB.prepare(`
      INSERT OR REPLACE INTO seq_lead_magnets (
        id,
        product_id,
        slug,
        name,
        asset_r2_bucket,
        asset_r2_key,
        fulfillment_sequence_slug,
        conversion_event_name,
        active
      )
      VALUES (
        ?,
        ?,
        ?,
        'System Guide',
        ?,
        ?,
        'system-welcome',
        ?,
        1
      )
    `)
    .bind(
      options.id ?? 'lm-system-guide',
      productId,
      options.slug ?? 'system-guide',
      options.assetR2Bucket ?? 'sequencer-assets',
      options.assetR2Key ?? 'lead-magnets/system.pdf',
      options.conversionEventName ?? null,
    )
    .run()
}

function productApiHeaders(): Headers {
  return new Headers({
    'Content-Type': 'application/json',
    'Cf-Access-Jwt-Assertion': accessJwt,
  })
}

function dashboardHeaders(token = dashboardAccessJwt): Headers {
  return new Headers({
    'Content-Type': 'application/json',
    'Cf-Access-Jwt-Assertion': token,
  })
}

function headerValue(headers: Headers | Record<string, string>, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name)
  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value
  }
  return null
}

async function signResendWebhook(
  messageId: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('system-resend-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${messageId}.${timestamp}.${body}`),
  )
  return `v1,${base64Encode(new Uint8Array(signature))}`
}

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function installAccessJwtSigner(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  publicJwk.kid = 'system-test-key'
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'

  fetchMock.activate()
  fetchMock.disableNetConnect()
  fetchMock
    .get(issuer)
    .intercept({ method: 'GET', path: '/cdn-cgi/access/certs' })
    .reply(200, { keys: [publicJwk] })
    .persist()

  signAccessJwtWithTestKey = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'system-test-key' })
      .setIssuer(issuer)
      .setAudience('sequencer-system-test-aud')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
}

async function createAccessJwt(claims: Record<string, unknown>): Promise<string> {
  if (!signAccessJwtWithTestKey) throw new Error('Access JWT signer is not installed')
  return signAccessJwtWithTestKey(claims)
}
