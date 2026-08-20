# Testing

This is the companion to [ENGINEERING-LOG.md](ENGINEERING-LOG.md)'s ["how this is
tested"](ENGINEERING-LOG.md#how-this-is-tested) section and to [METRICS.md](METRICS.md)'s "Tests
and coverage" numbers. Those two say *what the totals are* and *what ran automatically*. This
document says what the tests actually protect, file by file, and what they do not.

Every claim below was checked against the test files themselves: test titles, mock setup, and
what each file does and does not exercise for real. Where a behaviour is asserted only through a
mocked collaborator rather than a real implementation, that is stated, because it changes what
the test is actually worth.

- [Suite shape and commands](#suite-shape-and-commands)
- [What actually stops a double send](#what-actually-stops-a-double-send)
- [Suppression: gated everywhere, unproven where it lives](#suppression-gated-at-every-call-site-not-exercised-where-it-is-implemented)
- [Webhook verification: checked and not checked](#webhook-verification-what-is-checked-and-what-is-not)
- [Workers-runtime system tests](#workers-runtime-system-tests)
- [Migration integrity](#migration-integrity)
- [Per-file coverage gate on the dashboard](#per-file-coverage-gate-on-the-dashboard)
- [Content policy and documentation drift](#content-policy-and-documentation-drift)
- [Meta-tests over the repo's own tooling](#meta-tests-over-the-repos-own-tooling)
- [Limits](#limits)

## Suite shape and commands

Three Vitest configs, each scoped to a different slice of the tree:

```bash
pnpm test               # vitest.config.ts    - 1,747 tests across 149 files, node environment
pnpm test:web           # vitest.web.config.ts - the apps/web subset only, no coverage gate
pnpm test:web:coverage  # same config, --coverage, enforces the per-file gate
pnpm test:system        # vitest.system.config.ts - 14 tests, real Workers runtime
pnpm test:all           # pnpm test && pnpm test:system
```

[vitest.config.ts](../vitest.config.ts) is the root config: `environment: 'node'`, workspace
package aliases (`@sequencer/db`, `@sequencer/emails`, `@sequencer/sdk`, `@sequencer/shared`),
and it excludes only `apps/api/src/system-tests/**`. It does **not** exclude `apps/web`: the
dashboard's 79 test files run here too, in `node`, using `react-dom/server`'s
`renderToStaticMarkup` rather than a DOM. 149 files matches exactly: 79 web-app test files plus
70 test files under `apps/api`, `packages/*`, and `scripts/*`, with the one system-test file
excluded.

[vitest.web.config.ts](../vitest.web.config.ts) re-runs that same 79-file `apps/web` subset a
second time under a config that adds the coverage gate described
[below](#per-file-coverage-gate-on-the-dashboard). The same test files execute under both
commands; only the second run is gated. `pnpm test` is what tells you the suite passes.
`pnpm test:web:coverage` is what tells you it passes *and* clears the floor.

A handful of interaction tests need a real DOM instead of `renderToStaticMarkup`. Those opt in
per file with a `// @vitest-environment jsdom` docblock plus
`import '../test/interaction-setup'` ([apps/web/src/test/interaction-setup.ts](../apps/web/src/test/interaction-setup.ts)),
which patches `hasPointerCapture`/`scrollIntoView`/`ResizeObserver` (jsdom has none of them, and
Radix UI's primitives call all three). Keeping the patch file-scoped rather than a global
`setupFiles` entry means the `node`-environment majority of the suite is unaffected by it.

[vitest.system.config.ts](../vitest.system.config.ts) is different in kind, not just scope: see
[Workers-runtime system tests](#workers-runtime-system-tests).

## What actually stops a double send

The README's framing question. Three separate mechanisms, tested at three separate layers:

**One running run per contact per product.** The partial unique index on
`(contact_id, product_id) WHERE status = 'running'`
([packages/db/src/schema/runs.ts](../packages/db/src/schema/runs.ts), detailed in
[ENGINEERING-LOG.md #1](ENGINEERING-LOG.md#1-one-running-sequence-per-contact-enforced-by-the-database))
is exercised under real concurrency conditions in
[one-active-run-routes.test.ts](../apps/api/src/__tests__/one-active-run-routes.test.ts), 1,525
lines and the largest test file in the repo. Two tests matter most: *"returns the winning run
when concurrent enrollment loses the unique-index race"* and *"enrolls with the winning contact
when concurrent contact creation wins the email race"*: both simulate the interleaving directly
rather than asserting the index exists, which is the only way to prove
`isRunningRunUniqueConflict` degrades a constraint violation into `status: 'already_running'`
instead of a 500.

**One message row per step, checked before the provider is ever called.**
[sequence-run-status-guard.test.ts](../apps/api/src/__tests__/sequence-run-status-guard.test.ts)
(1,731 lines) unit-tests the Durable Object's internal decision logic with every collaborator
mocked out (`checkSuppression`, `checkFirewall`, the Resend adapter, the template renderer, and
D1 are all `vi.fn()`). Inside that harness, *"treats an existing message row for a pending step as
sent before provider calls"* is the double-send guard itself: the DO checks for an existing
`seq_messages` row for the step **before** it calls Resend, not after, so a re-run of an already
reserved step cannot re-send even if the reservation write failed to update status cleanly.
*"backfills a missing message row when retrying an already-sent step"* and *"does not target sent
duplicate rows when recording a step error"* cover the row-repair paths around that same guard.
*"sends each step with a deterministic provider idempotency key"* and *"keeps provider idempotency
keys independent of unbounded YAML step ids"* cover the send call itself.

**Provider webhook redelivery.**
[cleanup-api.test.ts](../apps/api/src/__tests__/cleanup-api.test.ts) (6,029 lines, the second
largest file) covers the `(provider, provider_event_id)` unique-index dedupe end to end: *"acks
duplicate Resend provider event ids without replaying message side effects"* and *"replays side
effects for duplicate provider events until a prior attempt completes them"*: the second one is
the crash-recovery lease behaviour from
[ENGINEERING-LOG.md #3](ENGINEERING-LOG.md#3-four-independent-idempotency-layers), tested by
simulating a prior attempt that recorded the event but never finished applying it.

The client-facing `Idempotency-Key` layer (same-key replay returns `{ duplicate: true }`,
different-body-same-key returns `409`) is covered separately in
[events-product-scope.test.ts](../apps/api/src/__tests__/events-product-scope.test.ts) and the
lead-magnet download path inside `one-active-run-routes.test.ts`.

> [!NOTE]
> `do-engine.test.ts` sounds like it should be the Durable Object's test file. It is not: it
> tests `parseDelay` and `assignVariant`, two small pure functions, plus one assertion that
> `SequenceRunDO` is exported as a class. The DO's actual behaviour lives entirely in
> `sequence-run-status-guard.test.ts` above and in the one system test that runs a real alarm.
> The filename is misleading; the coverage it implies exists, just not in that file.

## Suppression: gated at every call site, not exercised where it is implemented

`checkSuppression` and `checkFirewall` are called from four route-level locations plus the
Durable Object, per
[SECURITY.md](SECURITY.md#suppression-checked-at-enrollment-checked-again-before-every-send).
Every one of those call sites is tested, but every one of them tests it through a mock:

- `contacts-upsert-guards.test.ts`, `lists-route.test.ts`, `sequence-transition.test.ts`,
  `one-active-run-routes.test.ts`, and `sequence-run-status-guard.test.ts` all
  `vi.mock('../lib/suppression', ...)` and assert *that the function was called, with the right
  arguments, at the right point in the flow*, for example *"exits the run and deletes the alarm
  when suppression is active before sending"* proves the DO checks suppression before sending
  and reacts correctly to a positive result, using a hand-set mock return value.
- The file actually named `suppression.test.ts` (42 lines) does not test suppression logic. It
  imports `checkSuppression`, `addSuppression`, and `removeSuppression` and asserts they are
  functions, then separately checks that `PRODUCT_FIREWALL` is empty now that its one partner
  product has been retired. It is a shape check, not a behaviour test.

What is real, and D1-backed, is the *write* side and the *admin* side:
[add-suppression.test.ts](../apps/api/src/__tests__/add-suppression.test.ts) (188 lines),
[suppression-delete.test.ts](../apps/api/src/__tests__/suppression-delete.test.ts) (175 lines),
[suppressions-list-filter.test.ts](../apps/api/src/__tests__/suppressions-list-filter.test.ts)
(260 lines), and [instantly-suppression-jobs.test.ts](../apps/api/src/__tests__/instantly-suppression-jobs.test.ts)
(132 lines, the durable Instantly-driven suppression sync) all exercise their D1 writes and
dashboard-facing behaviour directly, not through a mock of the suppression module.

What is missing is the *read* side's own implementation:
[apps/api/src/lib/suppression.ts](../apps/api/src/lib/suppression.ts)'s `checkSuppression`
checks a KV hot cache first (`supp:global:{email}`, then `supp:product:{productId}:{email}`,
1-hour TTL) and falls back to a D1 query scoped to global-or-this-product. No test in this
repository exercises that function against a real KV namespace or a real D1 row and confirms it
returns the right `suppressed`/`scope`/`reason`, not a unit test, and not the one system test
that runs a real DO send (which never seeds a suppression row). The gate placement is proven
everywhere it matters; the gated function's own correctness is not proven anywhere with real
data.

## Webhook verification: what is checked, and what is not

Both webhook routes are hardened in
[ENGINEERING-LOG.md #8](ENGINEERING-LOG.md#8-webhook-verification-with-a-replay-window) and
[SECURITY.md](SECURITY.md). The test coverage in
[cleanup-api.test.ts](../apps/api/src/__tests__/cleanup-api.test.ts) is real for some failure
modes and absent for others.

**Resend (Svix HMAC-SHA256 over `{msg_id}.{timestamp}.{body}`, 300-second replay window).**
Tested: *"rejects signed Resend webhooks with malformed timestamp headers"* (a `junk`-suffixed
timestamp fails the `/^\d+$/` check and returns `401`), *"rejects signed Resend JSON payloads
that are not objects"* (`400`), and *"normalizes non-string Resend event types before queueing"*.
Every one of these tests signs the payload correctly with a real HMAC first: the signature
itself is always valid in every Resend test in this repository. **Not tested anywhere:** a
request with a well-formed timestamp and a genuinely wrong or tampered signature reaching the
`401 Invalid signature` branch, and the `RESEND_WEBHOOK_SECRET` unset case reaching the
`500 Webhook verification not configured` branch. `verifyResendSignature` itself
([apps/api/src/webhooks/resend.ts](../apps/api/src/webhooks/resend.ts)) is not exported, so it
can only be reached through the route, and no test drives it down the "signature doesn't match"
path.

**Instantly (shared-secret header, constant-time compare).** Tested more completely: *"verifies
the secret, tracks a metric, and enqueues one normalized event"* is the happy path, and *"rejects
bad secrets and invalid JSON"* directly exercises the `401 Unauthorized` branch with a
`x-instantly-webhook-secret: wrong` header. That is the one signature/secret-rejection path in
either webhook that is actually covered. The `INSTANTLY_WEBHOOK_SECRET` unset case is not
tested, same gap as Resend's missing-secret branch.

**What the system test adds.** The one Workers-runtime test per provider
(`accepts an authenticated Resend webhook through Worker ingress`,
`accepts an authenticated Instantly webhook through Worker ingress`) proves the real route works
end to end against the real Worker export, but both are happy-path only, one call each, valid
signature both times. They add runtime-fidelity to the happy path already covered above; they do
not add rejection coverage.

## Workers-runtime system tests

[vitest.system.config.ts](../vitest.system.config.ts) uses `@cloudflare/vitest-pool-workers` to
boot the actual Workers runtime against the real
[apps/api/wrangler.toml](../apps/api/wrangler.toml), with real D1, R2, KV, Queue, and Durable
Object bindings, and loads the real migration files through `readD1Migrations`. Only four values
are injected rather than real: `CF_ACCESS_TEAM_NAME`, `CF_ACCESS_AUD`,
`INSTANTLY_WEBHOOK_SECRET`, `RESEND_API_KEY_CAMAUDIT`, `RESEND_WEBHOOK_SECRET`, and
`UNSUBSCRIBE_SIGNING_SECRET`: test-scoped values for things that would otherwise require a real
Cloudflare Access tenant or a real Resend account. Everything downstream of those six values is
real: the queue message actually round-trips through the platform's queue implementation, the
Durable Object actually schedules and fires a real `alarm()`, and D1 actually enforces its
constraints.

The 14 tests, one file, in order: the health endpoint; contact creation and enrollment through a
real DO start; the internal overview's Access allowlist; lead-magnet creation against real D1/R2;
template preview rendering; a lead-magnet download with R2 streaming; a product-scoped R2 asset
stream; a lead-magnet conversion event reaching an active run; **a scheduled DO alarm producing a
persisted send** (the one place the full send path runs for real, not mocked); a Resend delivery
event through the exported `queue` handler; a final-step run marked `errored` on a later async
send failure; the two webhook-ingress happy paths above; and the exported `scheduled` D1 backup
handler.

`testTimeout: 20_000` here versus `15_000` in the other two configs: booting `miniflare` per
test is measurably slower than an in-process mock.

## Migration integrity

[migrations.test.ts](../packages/db/src/__tests__/migrations.test.ts) does not test application
behaviour; it tests that the migration history itself is internally consistent. Specific
assertions: every SQL file is tracked exactly once in the Drizzle journal, journal indexes are
sequential, every journal entry has a matching Drizzle snapshot, snapshots form a linear chain
(no branching history), every unique index migration is preceded by a dedupe step over existing
rows, and several individual expand-migrate-contract migrations preserved the specific rows they
claimed to (e.g. *"keeps active contact product memberships over stale inactive duplicates"*,
*"backfills product-scoped contact profiles for single-product contacts only"*). With 33
migrations and 21 tables, this is the test that would catch a migration silently dropping data
during a schema change, which the app-level tests have no way to see.

## Per-file coverage gate on the dashboard

[vitest.web.config.ts](../vitest.web.config.ts) sets:

```ts
thresholds: {
  perFile: true,
  statements: 95,
  branches: 95,
  functions: 90,
  lines: 95,
}
```

`perFile: true` is the load-bearing setting. Vitest's default coverage gate is an aggregate
across the whole `include` set, which lets one well-tested file's surplus offset another file
that has almost no tests at all. With `perFile: true`, every individual file under
`apps/web/src` (minus the excludes below) independently has to clear 95% statements, 95%
branches, 90% functions, and 95% lines, or the run fails: a single untested component fails the
gate on its own, regardless of how well everything else is covered.

**This gate applies to `apps/web/src` only.** `apps/api`, `packages/db`, `packages/emails`,
`packages/sdk`, `packages/shared`, and `scripts/seq` have no coverage gate of any kind: nothing
in a config anywhere enforces a coverage floor on the Worker, the Durable Object, or the DB
schema. The 99.58% / 98.43% / 97.51% figures in [METRICS.md](METRICS.md) and the README are the
*aggregate reported by the coverage tool* across the dashboard files after the gate passes; they
describe the outcome, not the mechanism. The mechanism is the 95/95/90/95 floor, and it only
watches the SPA.

Four categories are excluded from the gate rather than silently counted against it, with a
comment in the config explaining each: `main.tsx` (bootstrap, no branching), `App.tsx`
(declarative route table, no branching), `lib/types.ts` (type-only, no runtime), and
`test/**` (test helpers). Excluding a bootstrap file from a coverage gate is defensible; it is
also worth naming rather than leaving a reader to wonder why the number isn't 100%.

`pnpm test:web:coverage` is a local command. It is not run by
[scripts/deploy-production.mjs](../scripts/deploy-production.mjs) (see
[METRICS.md's CI section](METRICS.md#ci)), so nothing currently blocks a deploy if this gate
would fail. It has to be run and read by hand.

## Content policy and documentation drift

Two categories of test assert on things that are not application code at all.

**The cadence and content linter.**
[sequence-cadence-policy.test.ts](../scripts/seq/__tests__/sequence-cadence-policy.test.ts)
tests `validateSequencePolicy` directly against the rules described in
[ENGINEERING-LOG.md #10](ENGINEERING-LOG.md#10-a-content-policy-linter-that-fails-the-build):
exactly 14 daily touches, the first landing by day 1, rejection of too few/too many/non-daily
gaps, the `resource`-step exemption from the count (while its delay still has to accumulate into
the schedule), and the "just checking in"-style subject regex, including a case that confirms
the regex still scans every step even when an earlier one already failed. `pnpm seq compile`
runs this against every YAML file in `sequences/`, so a violation blocks the build rather than
merely failing a test.

**Docs that fail their own tests.** A handful of files under `scripts/seq/__tests__/` read
actual markdown out of `docs/` and assert on its content rather than treating it as inert prose:
`lead-magnet-assets-audit-doc.test.ts` checks that
[docs/lead-magnet-product-assets-audit.md](../docs/lead-magnet-product-assets-audit.md)'s
per-product cutover status, required lead-magnet counts, and rollout-seed description all match
the current manifest; `rollout-audit-doc.test.ts` checks that
[docs/product-rollout-audit.md](../docs/product-rollout-audit.md) describes migrations as
expand-deploy-contract (not one-step), documents the real one-click-unsubscribe routing, and
points alert/logpush setup at the production Worker name; `production-config-doc.test.ts` checks
the documented `wrangler` invocation is the workspace-local one. These run under plain `pnpm
test`, so a doc that goes stale against the code it describes fails the next local run: the
mechanism is the same idea as the coverage gate, applied to prose instead of code.

## Meta-tests over the repo's own tooling

A smaller category tests the repository's own configuration and scripts, not product behaviour:
`wrangler-config.test.ts` asserts local and production `wrangler.toml` configs bind the same D1
database and KV namespaces and, the one with the sharpest teeth, *"never commits real
Cloudflare resource identifiers"*, scanning the committed config for anything that isn't a
`PLACEHOLDER_*` token. `scripts/__tests__/package-scripts.test.ts`,
`scripts/__tests__/vitest-config.test.ts`, and `scripts/__tests__/wrangler-output.test.ts` assert
on `package.json` script wiring, the Vitest configs themselves, and `wrangler`'s CLI output
parsing. `scripts/seq/__tests__/generated-artifacts.test.ts` and `retired-products.test.ts` guard
against stale generated output and dead product references respectively. None of this exercises
a request path; all of it exists so a config change or a `seq` CLI change fails fast rather than
surfacing as a production incident.

## Limits

- **No CI ran any of this automatically.** [METRICS.md's CI section](METRICS.md#ci) has the
  full account: only `scripts/deploy-production.mjs` was mandatory, and it runs `pnpm
  test:system`, not `pnpm test`, not `pnpm test:web:coverage`, not `pnpm lint:ci`. Every number
  in this document was produced by a human running a command by hand.
- **`checkSuppression`'s own implementation has no test with real KV or D1.** See
  [above](#suppression-gated-at-every-call-site-not-exercised-where-it-is-implemented). Every
  caller is proven to call it correctly; the function itself is not proven to answer correctly.
- **Signature-rejection coverage on the Resend webhook is incomplete.** A tampered-but-well-formed
  HMAC signature, and a missing `RESEND_WEBHOOK_SECRET`, both reach code paths with no test
  driving them. See [above](#webhook-verification-what-is-checked-and-what-is-not).
- **DST coverage is US-only.** Per
  [ENGINEERING-LOG.md #6](ENGINEERING-LOG.md#6-send-windows-that-survive-daylight-saving),
  `send-window.test.ts` only exercises US time zones. Half-hour and 45-minute offset zones
  (India, Nepal, parts of Australia) are reasoned about in the implementation, not covered by a
  test.
- **No production traffic ever touched this suite.** Every test, including the Workers-runtime
  system tests, runs against seeded or synthetic data. Resend and Instantly are always either
  mocked (`vi.fn()`) or replaced with a test secret against the real HTTP surface of a stubbed
  handler; no test in this repository makes a real network call to either provider. Whether the
  send path behaves the same way against Resend's actual API under real load was never something
  this suite could tell you.
- **No browser-level end-to-end tests.** The `.interaction.test.tsx` files render real components
  in jsdom and fire real DOM events, which is meaningfully more than a snapshot test, but jsdom
  is not a browser: no test in this repository opens the built SPA in Chromium or Firefox and
  drives it.
- **No load, fuzz, or mutation testing.** The rate limiter's read-modify-write fix
  ([ENGINEERING-LOG.md #2](ENGINEERING-LOG.md#2-a-rate-limiter-with-no-read-modify-write-race))
  is reasoned from the SQL, not proven under a real concurrent burst against D1. No test suite in
  this repository was ever run through a mutation-testing tool, so "the tests pass" and "the
  tests would fail if the logic they cover were broken" were never independently checked against
  each other.
