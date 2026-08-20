# Ventora Sequencer - Operations Playbook

Operational runbook for the Sequencer Worker.

## Daily Health Checks (GREEN - autonomous)

- Check Workers Observability for error spikes
- Check Analytics Engine for `send.failed` count
- Check Instantly sync ran (look for today's `seq_instantly_campaign_daily_stats` rows)
- Check domain health rollup completed (today's `seq_domain_health` row exists per sending domain)
- Check the D1 backup cron wrote a manifest to `sequencer-logs/backups/d1/latest.json`

## Backups

The daily `0 4 * * *` cron writes a best-effort, non-transactional JSON export of all `seq_*`
tables to the `LOGS_BUCKET` R2 binding. Each run writes:

- Chunk objects under `backups/d1/<timestamp>/<table>/<chunk>.json`
- A run manifest at `backups/d1/<timestamp>/manifest.json`
- A latest pointer at `backups/d1/latest.json`

Keep the `backups/` R2 prefix out of log-retention lifecycle deletion rules.

## Dead-Letter Queue

The `events-queue` consumer is configured with `dead-letter-queue`, and exhausted Durable Object
step retries also send a diagnostic payload to the `DEAD_LETTER_QUEUE` binding. Provider webhook
queue bodies can be replayed through the same production consumer by validating a captured payload
and pushing it back to `events-queue`.

For an incident:

1. Inspect `dead-letter-queue` in Cloudflare Queues and copy the payload, enqueue timestamp, retry
   metadata, and error details into the incident notes.
2. Fix the root cause before replay. For provider webhook messages, replay from the provider if
   possible, or write the captured queue body to a reviewed JSON file and validate it:
   ```bash
   pnpm seq dlq replay --dry-run --source dist/incidents/dlq-message.json --account-id <account_id> --queue-id <events_queue_id>
   ```
   Then replay with a Queues Write API token:
   ```bash
   CLOUDFLARE_API_TOKEN=<queues_write_token> pnpm seq dlq replay --source dist/incidents/dlq-message.json --account-id <account_id> --queue-id <events_queue_id>
   ```
   Product API events do not enter this queue; `/api/v1/events` returns `207` when Durable Object
   delivery fails.
3. For exhausted DO step payloads, inspect the referenced run, sequence, and step. After retries
   are exhausted, the run is already marked `errored`; do not wait for another automatic retry.
   Recovery requires a reviewed one-off repair, re-enrollment, or manual resend path. Do not edit
   D1 or DO storage by hand.
4. Purge or archive the DLQ message only after the replacement action succeeds.

## Sequence Management

### Compile and deploy new sequences
```bash
pnpm deploy:prod:dry-run  # compile + diff check + readiness + Worker dry-run, without remote mutations
pnpm deploy:prod          # compile, deletion guard, build, deploy dry-run, pre-sync readiness, sync remote D1, post-sync readiness, deploy
```

### Migration releases

Use expand/deploy/contract for production D1 changes. The legacy migrate-and-deploy shortcut is
disabled because a migration that changes a live write contract before the compatible Worker is
deployed can break production. For changes like `seq_sequence_runs.product_id`, first apply an
expand migration that is additive and old-Worker compatible, deploy the compatible Worker with
`pnpm deploy:prod`, then ship the contract migration in a later release after production has been
verified.

### Check inactive sequence candidates
```bash
pnpm seq rot
```
This checks active production D1 sequences with no enrollments in the last 90 days. Use
`pnpm seq rot --local` only when intentionally checking the local D1 database.

### Manual enrollment
```bash
curl -X POST https://sequencer.ventoralabs.com/api/v1/enrollments \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -d '{"email":"user@example.com","sequence_slug":"camaudit-cam-reconciliation-checklist"}'
```

## Contact Management

### Manual suppression
```bash
# Use the dashboard Suppressions page for manual global or product-scoped suppressions.
# Product API tokens may only create product-scoped unsubscribes:
curl -X POST https://sequencer.ventoralabs.com/api/v1/unsubscribe \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -d '{"email":"user@example.com","product":"camaudit"}'
```

### CSV import
There is no CSV import CLI in this repository. Use the product app's import flow or call
`POST /api/v1/contacts` from a controlled script with the product's Cloudflare Access service token.

## Rollout Readiness

Use `pnpm seq readiness --remote --out dist/readiness-report.json` for current product rollout
state. Historical cutover notes live in `docs/live-product-sequencer-cutover-audit.md` and
`docs/product-rollout-audit.md`; the dashboard no longer exposes the old placeholder migration page.

## Emergency Procedures

### Stop all sends for a product
1. Set `is_active = false` on all sequences for the product in D1:
   ```sql
   UPDATE seq_sequences SET is_active = FALSE WHERE product_id = 'prod_camaudit';
   ```
2. This stops new step executions. In-flight DOs will check `is_active` on next alarm.

### Global suppression bulk import
Use the dashboard for individual global suppressions. For a bulk suppression event, run a reviewed
one-off script against the internal dashboard API with a Cloudflare Access user identity; do not use
product service tokens for global suppressions.

### Check a specific contact
```bash
curl https://sequencer.ventoralabs.com/api/v1/contacts/user%40example.com \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET"
```
