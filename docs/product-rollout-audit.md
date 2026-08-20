# Product Rollout Audit

## Scope

Sequencer currently manages these live products:

- `camaudit`
- `floriva-web`

Shutdown products are removed from live schema validation, sequence source, Worker bindings, required secrets, email template exports, and readiness manifests. Cleanup migrations through `0032_remove_grantpipe` remove their production rows from `seq_api_tokens`, `seq_lead_magnets`, `seq_sequences`, and `seq_products`.

## Readiness Gates

Use live gate outputs rather than stale blocker snapshots:

- `pnpm seq compile`
- `pnpm seq readiness --remote`
- `pnpm seq diff --check`
- `dist/readiness-report.json`

Do not copy point-in-time blocker lists into this audit. Readiness must be proven from the current command output, including no pending remote D1 migrations.

## Lead Magnets

The rollout path writes the required Sequencer-managed lead-magnet row SQL through `pnpm seq lead-magnet-sql`.

Required Sequencer-managed lead-magnet rows are active.

Required Sequencer-managed lead-magnet R2 assets exist.

The generated SQL inserted/updated the active Sequencer-managed lead-magnet rows and disables stale active rows for products present in the manifest.

Product-owned dynamic flows must serve the asset in the product app and call `enroll` instead of `downloadLeadMagnet`.

## Release Contract

Migration releases follow expand/deploy/contract. Apply remote migrations first, verify readiness, deploy, then perform any cleanup that depends on the deployed Worker behavior.
