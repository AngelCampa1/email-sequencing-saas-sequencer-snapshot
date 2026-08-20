# Product Client Integration

Sequencer product API calls are authenticated by Cloudflare Access service tokens, then mapped to a product through `seq_api_tokens`.

## Live Products

| Product | Slug | Product id | Resend secret | Sequence slugs |
| --- | --- | --- | --- | --- |
| CAMAudit | `camaudit` | `prod_camaudit` | `RESEND_API_KEY_CAMAUDIT` | Current partner lead magnets use `camaudit-{lead_magnet_slug}` |
| Floriva | `floriva-web` | `prod_floriva_web` | `RESEND_API_KEY_FLORIVA_WEB` | `floriva-web-fulfillment-welcome`, `floriva-web-nurture-value-1`, `floriva-web-lead-magnet-nurture` |

## Product Secrets

Each product app stores:

```text
SEQUENCER_BASE_URL=https://sequencer.ventoralabs.com
SEQUENCER_CF_ACCESS_CLIENT_ID=<Cloudflare Access service token client id>
SEQUENCER_CF_ACCESS_CLIENT_SECRET=<Cloudflare Access service token client secret>
```

Sequencer D1 stores only the Access client id in `seq_api_tokens.access_service_token_id`.

To write a placeholder SQL template, explicitly opt in:

```bash
pnpm seq token-sql --allow-placeholders --out dist/product-api-tokens.sql
```

## SDK Usage

```ts
import { SequencerClient } from '@sequencer/sdk'

const sequencer = new SequencerClient({
  baseUrl: env.SEQUENCER_BASE_URL,
  clientId: env.SEQUENCER_CF_ACCESS_CLIENT_ID,
  clientSecret: env.SEQUENCER_CF_ACCESS_CLIENT_SECRET,
})

await sequencer.upsertContact({
  email,
  product: 'camaudit',
  properties: { source: 'signup' },
})

await sequencer.fireEvent({
  email,
  product: 'camaudit',
  event: 'signup_completed',
  properties: { source: 'signup' },
})
```

Cross-product calls are intentionally rejected.
