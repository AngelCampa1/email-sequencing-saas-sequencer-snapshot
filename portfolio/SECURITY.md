# Security

Sequencer handles contact records, email addresses, suppression and unsubscribe state, and the
per-product credentials used to send mail. This document describes how the source code enforces
three boundaries: who is allowed to call the system, whether a suppressed contact can still
receive mail, and whether one product's send credential can be used to send as another product.

Every claim below is traced to a file: a description of what the code does, verified by reading
the code itself.

- [Three authentication surfaces, and why they are separate](#three-authentication-surfaces-and-why-they-are-separate)
- [Suppression: checked at enrollment, checked again before every send](#suppression-checked-at-enrollment-checked-again-before-every-send)
- [Per-product Resend key isolation](#per-product-resend-key-isolation)
- [What `seq_api_tokens` is not for](#what-seq_api_tokens-is-not-for)
- [Boundaries that are partial, stated plainly](#boundaries-that-are-partial-stated-plainly)

## Three authentication surfaces, and why they are separate

One Worker deployment serves three kinds of caller, and each is verified by a different
mechanism rather than one shared auth layer:

**`/api/v1/*` and `/api/client/v1/*`: product backends, via Cloudflare Access service
tokens.** `requireProductApiClientContext` in
[apps/api/src/lib/product-api-auth.ts](../apps/api/src/lib/product-api-auth.ts) verifies the
`Cf-Access-Jwt-Assertion` header as an Access-signed JWT (RS256, checked against the team's
JWKS, with issuer and audience pinned) in
[apps/api/src/lib/access.ts](../apps/api/src/lib/access.ts), then reads the verified service
token's client id from the `common_name` or `service_token_id` claim and requires it to end in
`.access`. That client id is looked up in `seq_api_tokens` (see [What `seq_api_tokens` is not
for](#what-seq_api_tokens-is-not-for)) to resolve exactly one product slug in
[apps/api/src/lib/client-product.ts](../apps/api/src/lib/client-product.ts). A revoked token
(`revoked_at` set) is excluded by that lookup's `WHERE` clause, so revocation takes effect on
the next call rather than requiring a deploy. Every route handler under this surface calls
`requireProductApiClientContext` itself, for example
[apps/api/src/routes/api/v1/enrollments.ts:26-27](../apps/api/src/routes/api/v1/enrollments.ts#L26-L27),
rather than trusting a value set by earlier middleware, so the same verification runs on
every request regardless of what the rate limiter already did with it.

**`/api/internal/*` and `/me`: the operator dashboard, via Cloudflare Access with a Google
IdP.** [apps/api/src/routes/internal/index.ts:176-198](../apps/api/src/routes/internal/index.ts#L176-L198)
registers `internalRoute.use('*', ...)`, so every internal route is gated before its handler
runs. It verifies the same Access JWT format, then calls `requireDashboardAccessJwt`, which adds
a second, application-level check on top of Access: the verified email must be present in
`DASHBOARD_ALLOWED_EMAILS`, a `Set` literal hardcoded in
[apps/api/src/lib/access.ts](../apps/api/src/lib/access.ts) (sanitized to a placeholder address
in this snapshot). A caller who passes Access but is not on that list gets `403`, not `401`
([apps/api/src/lib/access.ts](../apps/api/src/lib/access.ts)'s `DashboardAccessForbiddenError`),
which is a deliberately different status from "not authenticated at all."

**`/webhooks/resend` and `/webhooks/instantly`: provider callbacks, via signature or shared
secret, not Access.** Access is bypassed for these paths because Resend and Instantly cannot
present an Access JWT. Each verifies itself instead.
[apps/api/src/webhooks/resend.ts](../apps/api/src/webhooks/resend.ts) implements the Svix
scheme: it requires `svix-signature`/`svix-timestamp`/`svix-id` (or Resend's own header names),
rejects a timestamp more than 300 seconds from now before doing any cryptographic work, then
verifies HMAC-SHA256 against `RESEND_WEBHOOK_SECRET`, returning `500` if that secret is not
configured (our problem) versus `401` for a bad or missing signature (their problem).
[apps/api/src/webhooks/instantly.ts](../apps/api/src/webhooks/instantly.ts) is a shared-secret
check rather than a signature, with a code comment explaining why: "Instantly doesn't sign
webhooks like Resend, so we gate by a header secret provisioned in both Instantly and
Wrangler." It reads `x-instantly-webhook-secret` or a `Bearer` token and compares it against
`INSTANTLY_WEBHOOK_SECRET` with `constantTimeEqual`.

Separately from these three, `GET /unsubscribe` is deliberately unauthenticated by design (RFC
8058 one-click unsubscribe cannot require a login) and instead trusts an HMAC-signed token
embedded in the link itself; see
[portfolio/ARCHITECTURE.md](ARCHITECTURE.md#request-and-auth-topology) for that path.

## Suppression: checked at enrollment, checked again before every send

`checkSuppression` in [apps/api/src/lib/suppression.ts](../apps/api/src/lib/suppression.ts)
looks up an email against two KV hot-cache keys (`supp:global:{email}` and
`supp:product:{productId}:{email}`) and falls through to a D1 query scoped to `global` or
product-matched `product` rows if neither hits. It runs in two places, not one:

**At enrollment.** [apps/api/src/routes/api/v1/enrollments.ts:63-70](../apps/api/src/routes/api/v1/enrollments.ts#L63-L70)
calls it before a run is created; a suppressed contact never gets enrolled, and the caller gets
`422` with the scope that blocked them.

**Inside `SequenceRunDO`, immediately before every send.**
[apps/api/src/durable-objects/sequence-run.ts:454-467](../apps/api/src/durable-objects/sequence-run.ts#L454-L467)
calls the identical function again on every alarm wake, right before rendering the template,
and if the contact is now suppressed it cancels the run outright rather than sending or merely
skipping the one step.

The second check is deliberate, not a leftover: a sequence run can be alive for weeks, and a
contact can unsubscribe from a different product, bounce, or be added to the block list at any
point in that window. Checking only at enrollment would mean the suppression decision is stale
for the entire remaining run. Re-checking inside the DO on every wake means a suppression added
five minutes before a scheduled send still stops that send. This is the same shape as the
cross-product firewall check, which is also re-run inside the DO before every send rather than
only at enrollment: see [portfolio/ENGINEERING-LOG.md](ENGINEERING-LOG.md).

## Per-product Resend key isolation

`seq_products.resend_api_key_secret_name` is a required, non-null text column
([packages/db/src/schema/products.ts:13](../packages/db/src/schema/products.ts#L13)) that holds
the *name* of a Cloudflare Worker secret, not the API key itself. The key value lives only as an
encrypted Worker secret, uploaded via `wrangler secret bulk`
([docs/production-config-values.md](../docs/production-config-values.md)).

At send time, [apps/api/src/durable-objects/sequence-run.ts:519-591](../apps/api/src/durable-objects/sequence-run.ts#L519-L591)
loads `resend_api_key_secret_name` for the run's product and passes it to
`createResendAdapter`, which resolves it in
[apps/api/src/providers/resend.ts](../apps/api/src/providers/resend.ts): `getResendApiKey`
reads `env[secretName]` when a secret name is given, or falls back to a
`RESEND_API_KEY_{PRODUCT_SLUG}` convention if the row has none. Because the DO always loads the
product row for the run it is currently executing, and the secret name comes from that row
rather than from any caller-supplied input, one product's `SequenceRunDO` cannot be made to send
through another product's Resend key: the key it uses is a function of which product owns the
run, not of anything in the request. `docs/production-config-values.md` lists two concrete
examples of the convention in production: `RESEND_API_KEY_CAMAUDIT` and
`RESEND_API_KEY_FLORIVA_WEB`.

## What `seq_api_tokens` is not for

[packages/db/src/schema/api-tokens.ts](../packages/db/src/schema/api-tokens.ts) shows the whole
table: `id`, `product_id`, `label`, `access_service_token_id`, `created_at`, `revoked_at`. That
is the entire capability surface: a mapping from one verified Access service-token client id to
one product, plus a revocation timestamp.
[docs/production-config-values.md](../docs/production-config-values.md) states the boundary
explicitly: "`seq_api_tokens` maps verified Cloudflare Access service-token client ids
(`*.access`) to one live product. It is not for Worker deploys, D1, KV, R2, Queues, or storage
access." That is verifiable from the schema itself: the table has no column that could carry a
credential, a role, or a scope broader than "which product does this token belong to." A row in
this table cannot grant access to anything Cloudflare Access did not already verify; it narrows
an already-authenticated caller down to one product, it does not authenticate on its own.

## Boundaries that are partial, stated plainly

**The dashboard allowlist is a hardcoded `Set`, not a managed list.**
`DASHBOARD_ALLOWED_EMAILS` in [apps/api/src/lib/access.ts](../apps/api/src/lib/access.ts) is a
literal in source, not a D1 table or KV list. Changing who can use the dashboard means a code
change and a deploy, not a runtime operation. That is a real limitation of the design, not just
a publication artifact: the sanitization for this snapshot replaced the real address with
`operator@example.com`, but the mechanism (a source-level `Set`) is unchanged from what ran in
production.

**The development bypass is gated by an environment variable, not by anything cryptographic.**
Both [apps/api/src/routes/me.ts](../apps/api/src/routes/me.ts) and
[apps/api/src/routes/internal/index.ts:177-183](../apps/api/src/routes/internal/index.ts#L177-L183)
skip Access verification entirely when `c.env.ENVIRONMENT === 'development'` and no
`Cf-Access-Jwt-Assertion` header is present, returning a fixed operator identity so
`wrangler dev --local` works without a Zero Trust tenant in front of it. The code comments
assert this branch is unreachable in production because the production environment sets
`ENVIRONMENT="production"`, and `wrangler.toml` is the only place that variable is set for the
deployed Worker, but that guarantee depends entirely on that one environment variable being
correct at deploy time; nothing in this code path re-verifies it independently.

**Webhook replay protection is time-window based, not single-use.** The Resend webhook rejects
a timestamp more than 300 seconds old, but does not track message ids to reject a second
delivery of the same signed payload within that window: the ids are used for the queue's own
event-dedupe (`provider_event_id`), which happens after signature verification, not as part of
verification itself. A signature captured and replayed inside the 300-second window would pass
verification and only be caught downstream, by the unique index on `(provider,
provider_event_id)` in the queue consumer.

**Rate limiting is per-Worker-instance state in D1, not a WAF.** The tiers described in
[portfolio/ENGINEERING-LOG.md](ENGINEERING-LOG.md) throttle by counting rows in
`seq_rate_limit_windows`; they reduce the cost of a brute-force or scraping attempt against this
Worker but are not a substitute for network-layer protection, and this repository does not
configure or claim one.
