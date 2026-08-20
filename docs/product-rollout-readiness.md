# Product Rollout Readiness

Run these gates before enabling Sequencer calls from any live product:

```bash
pnpm seq compile --no-bundle
pnpm test
pnpm build
pnpm seq readiness --remote
```

The readiness command must pass before production deploy. It verifies production secrets, product rows, active synced sequences, at least one non-revoked `seq_api_tokens` mapping per live product, required active lead-magnet rows and product-owned R2 assets for Sequencer-managed lead-magnet flows, no pending remote D1 migrations, and no placeholder service-token client ids.

## Product Matrix

| Product | Product id | Required secret | API token row |
| --- | --- | --- | --- |
| CAMAudit | `prod_camaudit` | `RESEND_API_KEY_CAMAUDIT` | required |
| Floriva | `prod_floriva_web` | `RESEND_API_KEY_FLORIVA_WEB` | required |

## Sequence Sync Gate

The Durable Object loads sequence definitions from D1, so compiled YAML must be synced before final rollout verification:

```bash
pnpm seq compile
pnpm seq sync --remote
pnpm seq readiness --remote
```

Tokenized lead-magnet assets must be reachable at `/assets/lead-magnets/*` and legacy `/api/v1/lead-magnets/*/asset`; those URLs use short-lived KV tokens and should not require Cloudflare Access headers.
