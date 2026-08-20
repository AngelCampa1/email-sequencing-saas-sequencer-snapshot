# Sequencer - Production Deployment Checklist

## One-time setup

1. **Provision Cloudflare resources**
   ```bash
   node scripts/setup-cloudflare.mjs
   ```
   Follow the printed commands to create D1, KV, R2, Queues.

2. **Configure Cloudflare Access**
   - Dashboard -> Zero Trust -> Access -> Applications
   - Protect `sequencer.ventoralabs.com/me` and `sequencer.ventoralabs.com/api/internal/*`
   - Identity provider: Google
   - Allow email: `operator@example.com`
   - Protect `sequencer.ventoralabs.com/api/v1/*` with Cloudflare Access service-token policies for Ventora product clients
   - Bypass Access for `sequencer.ventoralabs.com/unsubscribe`; email footer unsubscribe links are public but still require a known `product` query parameter and create product-scoped suppressions only
   - Bypass Access for `sequencer.ventoralabs.com/assets/lead-magnets/*` and legacy `sequencer.ventoralabs.com/api/v1/lead-magnets/*/asset`; these URLs are protected by short-lived KV tokens and must be browser-fetchable by end users
   - Product API calls under `/api/v1/*` must pass through Cloudflare Access with a Service Auth policy; the verified service-token client id (`*.access`) must be mapped in `seq_api_tokens`, and the Worker rejects missing, unknown, revoked, or wrong-product service tokens
   - Bypass Access for `/webhooks/*` so providers can reach the Worker; Resend uses Svix/HMAC verification, and Instantly uses the configured shared-secret header or Bearer token check in the Worker
   - Decide whether `/health` is public for monitoring or Access-protected, then keep the Access policy and uptime checks aligned

3. **Substitute wrangler.toml resource IDs**
   `apps/api/wrangler.toml` ships with `PLACEHOLDER_*` tokens in place of the real D1 database
   id, KV namespace ids, Access AUD, and Access team name. Real identifiers are supplied out of
   band and are never committed: `apps/api/src/__tests__/wrangler-config.test.ts` fails the
   build if one appears in the file. Replace each `PLACEHOLDER_*` with the value reported by the
   provisioning commands from step 1 before deploying.

   Local development needs none of this. `wrangler dev --local` simulates every binding.

4. **Set secrets**
   ```bash
   cd apps/api
   pnpm exec wrangler secret put RESEND_WEBHOOK_SECRET --env production
   pnpm exec wrangler secret put UNSUBSCRIBE_SIGNING_SECRET --env production
   pnpm exec wrangler secret put INSTANTLY_WEBHOOK_SECRET --env production
   pnpm exec wrangler secret put INSTANTLY_API_KEY --env production
   pnpm exec wrangler secret put SENTRY_DSN --env production
   pnpm exec wrangler secret put RESEND_API_KEY_CAMAUDIT --env production
   # ... one per product
   ```
   `UNSUBSCRIBE_SIGNING_SECRET` signs public one-click unsubscribe links. Generate it as a
   high-entropy random value and rotate only with care because links generated with the old
   value stop validating.

   Required per-product Resend secrets:
   `RESEND_API_KEY_CAMAUDIT` and `RESEND_API_KEY_FLORIVA_WEB`.

   To generate a bulk secret JSON template:

   ```bash
   pnpm seq secret-template --out dist/production-secrets.template.json
   ```

   To generate only the secrets missing from the current production Worker:

   ```bash
   pnpm seq secret-template --missing-remote --out dist/missing-production-secrets.template.json
   ```

   Replace every placeholder with the real value, then upload from `apps/api`:

   ```bash
   pnpm exec wrangler secret bulk ../../dist/production-secrets.template.json --env production
   ```

   `pnpm apply:prod-config:dry-run` validates the filled template file before upload. If a secret
   key is omitted from the file, or left as a placeholder while it already exists on the production
   Worker, the guarded apply skips that key. Worker secrets are write-only and cannot be read back.
   Use `pnpm seq readiness --remote` to see which secret names are already present on the Worker.
   To validate the missing-only file with the guarded helper, pass it explicitly. Run the non-dry
   apply after sequences, lead magnet rows, and lead magnet assets are in place.

   ```bash
   pnpm apply:prod-config:missing:dry-run
   ```

5. **Apply initial migrations**
   ```bash
   pnpm exec wrangler d1 migrations apply sequencer-db --remote --config apps/api/wrangler.toml
   ```

   For later releases, do not use a one-step migrate-and-deploy command. Any migration that is not
   compatible with both the currently deployed Worker and the new Worker must be split into an
   expand/deploy/contract sequence before it is applied to production.

6. **Create product API token mappings**
   For each Cloudflare Access service token allowed to call `/api/v1/*`, insert one row in
   `seq_api_tokens` with the token's Access client id (`*.access`) and the matching product id.
   Cloudflare Access must protect `/api/v1/*` so those client headers are verified before the
   Worker runs.

   See `docs/production-config-values.md` for a concise map of which values belong in Worker
   secrets, product app secrets, and `seq_api_tokens`.

   ```sql
   INSERT INTO seq_api_tokens (id, product_id, label, access_service_token_id)
   VALUES ('tok_camaudit_prod', 'prod_camaudit', 'CAMAudit production', '<access_client_id>');
   ```

   To write placeholder SQL for every live product, explicitly opt into template output:

   ```bash
   pnpm seq token-sql --allow-placeholders --out dist/product-api-tokens.sql
   ```

   To generate a fill-in checklist for the Cloudflare Access service-token client ids:

   ```bash
   pnpm seq access-token-template --out dist/access-service-tokens.template.json
   ```

   Replace each `<access_client_id_for_*>` placeholder with the service-token client id ending in
   `.access`. Product apps store that same client id plus the client secret.

   The readiness gate rejects placeholder or malformed values, so do not apply placeholder SQL
   as-is. `pnpm seq token-sql --out ...` also refuses to write placeholder files unless
   `--allow-placeholders` is present.

   After filling `dist/access-service-tokens.template.json`, generate SQL from that structured file:

   ```bash
   pnpm seq token-sql --access-token-file dist/access-service-tokens.template.json --out dist/product-api-tokens.sql
   ```

   Prefer the guarded helper below to apply the SQL, because it validates both production config
   files first and runs Wrangler from the Worker config directory.

   See `docs/product-client-integration.md` for the product-side environment variables and SDK
   usage expected by each live product.

7. **Compile and sync sequences**
   The Worker runtime reads sequence definitions from `seq_sequences` in D1. Sync sequences before
   applying lead magnet rows so each `fulfillment_sequence_slug` already exists when downloads
   begin.

   ```bash
   pnpm seq compile
   pnpm seq sync --remote
   ```

8. **Seed Sequencer-managed lead magnets and verify product assets**
   Insert active `seq_lead_magnets` rows for every production lead magnet served through Sequencer.
   The rows must point at each product's own R2 bucket/key. Do not copy product lead-magnet files
   into `sequencer-assets`.

   Generate the required lead-magnet SQL and product asset verification plan:

   ```bash
   pnpm seq lead-magnet-sql --out dist/required-lead-magnets.sql
   pnpm seq lead-magnet-assets --out dist/required-lead-magnet-assets.ps1
   ```

   The generated SQL contains one active `seq_lead_magnets` row per Sequencer-managed lead magnet in
   the readiness manifest.

   The generated PowerShell downloads each required asset from its product-owned R2 bucket to prove
   the key exists before the D1 rows are applied.

   ```powershell
   pwsh -File dist/required-lead-magnet-assets.ps1
   ```

   After product asset verification passes, apply the D1 rows:

   ```bash
   pnpm exec wrangler d1 execute sequencer-db --remote --file ./dist/required-lead-magnets.sql --config apps/api/wrangler.toml
   ```

   Readiness fails until all required Sequencer-managed lead-magnet rows match the manifest, all
   referenced product R2 assets exist, and every live-product lead-magnet nurture
   sequence is synced.

9. **Apply production config and run readiness gate**
   After sequences, lead magnet assets, and lead magnet rows exist, apply the filled secret/token
   artifacts. This must pass before deploy.

   ```bash
   pnpm apply:prod-config:missing
   pnpm apply:prod-config:dry-run
   pnpm apply:prod-config
   ```

   Then run readiness. It verifies production secrets, product rows, synced active sequences,
   required Sequencer-managed lead magnet rows and product assets, live-product lead-magnet nurture
   sequences, no pending remote D1 migrations, and at least one non-revoked `seq_api_tokens`
   mapping per live product.

   ```bash
   pnpm seq readiness --remote
   ```

10. **Deploy**
   ```bash
   pnpm deploy:prod
   ```

11. **Configure custom domain**
   - Remove or replace the existing `sequencer.ventoralabs.com` custom domain from the old Pages project (`sequencer-web`)
   - Dashboard -> Workers & Pages -> `sequencer-api-production` -> Settings -> Domains & Routes
   - Add `sequencer.ventoralabs.com` as a Worker custom domain
   - Confirm the Worker custom domain is active before deleting the old Pages project
   - The old Pages project (`sequencer-web`) is no longer used once this custom domain points at the Worker

12. **Set up Workers Alerts** (see docs/workers-alerts.md)

13. **Set up Logpush** (see docs/workers-alerts.md)

14. **Verify**
    - Hit `https://sequencer.ventoralabs.com/health` and confirm it matches the intended Access policy
    - Load `https://sequencer.ventoralabs.com/` and confirm the SPA renders
    - Confirm unauthenticated `/me` and `/api/internal/*` requests are blocked by Cloudflare Access
    - Confirm the SPA shell can load and cannot read dashboard data until `/me` and `/api/internal/*` are authenticated
    - Confirm `/webhooks/*` reaches provider-specific Worker validation instead of an Access block
      (Resend Svix/HMAC; Instantly shared-secret header or Bearer token)
    - Confirm `/api/v1/*` accepts valid service-token clients and rejects invalid clients
    - Confirm `/unsubscribe?email=user@example.com&product=camaudit` stores a product-scoped suppression without Cloudflare Access
    - Confirm tokenized lead-magnet asset URLs under `/assets/lead-magnets/*` and legacy `/api/v1/lead-magnets/*/asset` are reachable without Cloudflare Access and reject missing/expired tokens

## Ongoing deployments

```bash
# Deploy the API Worker + SPA. This runs compile, deletion guard, build, system tests, Wrangler
# deploy dry-run, pre-sync readiness, Wrangler deploy, remote sequence sync, then post-sync readiness.
pnpm deploy:prod
```

Use `pnpm deploy:prod:dry-run` to exercise the same gate and bundling path without publishing or
mutating remote D1. The dry run intentionally skips remote sequence sync and remote migrations, but
still checks remote sequence convergence before readiness.

### Migration releases

The legacy migrate-and-deploy shortcut is intentionally disabled. Applying pending D1 migrations
before the compatible Worker is published can break live writes. Product-scoped run state is handled
with an expand-compatible migration: `0016_product_scoped_sequence_runs.sql` adds nullable
`product_id`, backfills from `seq_sequences`, preserves old-Worker inserts with an insert trigger,
and creates the product-scoped active-run index without rebuilding the live table.

Use expand/deploy/contract instead:

1. Split incompatible schema changes before release.
   - Expand migration: additive and old-Worker compatible only. For `seq_sequence_runs.product_id`,
     add a nullable `product_id`, backfill it from `seq_sequences`, mark orphaned running rows
     non-running, replace the global active-run index with a product-scoped index, and keep a
     legacy null-product guard/trigger so old Worker writes remain compatible during rollout.
   - Deploy: publish code that can run after the expand migration.
   - Contract migration in a later release: verify no null `product_id` rows remain, then enforce
     `product_id NOT NULL` and remove the legacy null-product guard/trigger.
2. Verify locally:
   ```bash
   pnpm test:all
   pnpm test -- packages/db/src/__tests__/migrations.test.ts scripts/__tests__/deploy-production.test.ts
   pnpm seq compile
   ```
3. Apply only reviewed expand-compatible migrations. Do not run a blanket production apply while
   destructive or contract migrations are still pending: Wrangler applies every pending migration
   in the directory. If the pending set includes cleanup deletes, deduplication, table rebuilds,
   `NOT NULL` enforcement, or new uniqueness constraints, stop and split/review the release first.
   Readiness rejects pending remote D1 migrations, so the guarded deploy dry-run is meaningful only
   after the reviewed expand set has been applied:
   ```bash
   pnpm exec wrangler d1 migrations apply sequencer-db --remote --config apps/api/wrangler.toml
   ```
4. Exercise the guarded deploy path without publishing:
   ```bash
   pnpm deploy:prod:dry-run
   ```
5. Deploy the compatible Worker:
   ```bash
   pnpm deploy:prod
   ```
6. Schedule the contract migration for a later release after the compatible Worker is live and the
   backfill has been verified in production.
