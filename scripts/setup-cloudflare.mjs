#!/usr/bin/env node
console.log(`
Ventora Sequencer - Cloudflare Resource Setup
=============================================
Run these commands to provision Cloudflare resources:

# 1. D1 Database
pnpm exec wrangler d1 create sequencer-db
# Paste the database_id into apps/api/wrangler.toml.

# 2. KV Namespaces
pnpm exec wrangler kv namespace create SUPPRESSIONS
pnpm exec wrangler kv namespace create SUPPRESSIONS --preview
pnpm exec wrangler kv namespace create SESSIONS
pnpm exec wrangler kv namespace create SESSIONS --preview
# Paste ids into apps/api/wrangler.toml.

# 3. R2 Buckets
pnpm exec wrangler r2 bucket create sequencer-assets
pnpm exec wrangler r2 bucket create sequencer-assets-dev
pnpm exec wrangler r2 bucket create camaudit
pnpm exec wrangler r2 bucket create floriva-lead-magnets
pnpm exec wrangler r2 bucket create sequencer-logs
pnpm exec wrangler r2 bucket create sequencer-logs-dev

# 4. Queues
pnpm exec wrangler queues create events-queue
pnpm exec wrangler queues create dead-letter-queue

# 5. Production values
pnpm seq secret-template --out dist/production-secrets.template.json
pnpm seq secret-template --missing-remote --out dist/missing-production-secrets.template.json
pnpm seq access-token-template --out dist/access-service-tokens.template.json
pnpm seq lead-magnet-sql --out dist/required-lead-magnets.sql
pnpm seq lead-magnet-assets --out dist/required-lead-magnet-assets.ps1

# Fill the missing secret template and Access token template with real values, then validate:
pnpm apply:prod-config:missing:dry-run

# Compile and sync sequences before applying lead magnet rows:
pnpm seq compile
pnpm seq sync --remote

# Verify required Sequencer-managed lead magnets in product-owned R2 buckets.
pwsh -File dist/required-lead-magnet-assets.ps1
pnpm exec wrangler d1 execute sequencer-db --remote --file ./dist/required-lead-magnets.sql --config apps/api/wrangler.toml

# After sequences, product lead magnet assets, and lead magnet rows exist, apply production config:
pnpm apply:prod-config:missing

# 6. Cloudflare Access (manual - dashboard.cloudflare.com)
# Zero Trust -> Access -> Applications -> Add Application
# Self-hosted, hostname: sequencer.ventoralabs.com
# Protect /api/v1/* with service-token policies for product clients.
# Protect /me and /api/internal/* with Google Workspace.
# Bypass /unsubscribe, /webhooks/*, /assets/lead-magnets/*, and /api/v1/lead-magnets/*/asset.

# Product apps store CF-Access-Client-Id and CF-Access-Client-Secret.
# Sequencer D1 seq_api_tokens stores the verified Access service-token client id (*.access).
# dist/access-service-tokens.template.json includes the expected dashboard service-token names.
`)
