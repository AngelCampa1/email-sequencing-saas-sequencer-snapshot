# Production Config Values

Sequencer production config has two classes of values:

1. Worker secrets stored on the Cloudflare Worker production environment.
2. Product API token mappings stored in D1 table `seq_api_tokens`.

## Worker Secrets

Required shared secrets:

- `RESEND_WEBHOOK_SECRET`
- `UNSUBSCRIBE_SIGNING_SECRET`
- `INSTANTLY_WEBHOOK_SECRET`
- `INSTANTLY_API_KEY`
- `SENTRY_DSN`

Required product Resend secrets:

- `RESEND_API_KEY_CAMAUDIT`
- `RESEND_API_KEY_FLORIVA_WEB`

Generate and upload the fill-in template:

```bash
pnpm seq secret-template --out dist/production-secrets.template.json
cd apps/api
pnpm exec wrangler secret bulk ../../dist/production-secrets.template.json --env production
```

## Product API Tokens

`seq_api_tokens` maps verified Cloudflare Access service-token client ids (`*.access`) to one live product. It is not for Worker deploys, D1, KV, R2, Queues, or storage access.

Generate the fill-in token template:

```bash
pnpm seq access-token-template --out dist/access-service-tokens.template.json
```

After replacing placeholders with real `.access` client ids, generate and apply SQL:

```bash
pnpm seq token-sql --access-token-file dist/access-service-tokens.template.json --out dist/product-api-tokens.sql
pnpm exec wrangler d1 execute sequencer-db --remote --file ./dist/product-api-tokens.sql --config apps/api/wrangler.toml
```
