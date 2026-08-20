# Engineering notes

Ten pieces of this codebase that were harder than they look, each with the failure they
prevent and the test that pins the behaviour. Architecture overview:
[ARCHITECTURE.md](ARCHITECTURE.md).

1. [One running sequence per contact, enforced by the database](#1-one-running-sequence-per-contact-enforced-by-the-database)
2. [A rate limiter with no read-modify-write race](#2-a-rate-limiter-with-no-read-modify-write-race)
3. [Four independent idempotency layers](#3-four-independent-idempotency-layers)
4. [Three retry policies, deliberately different](#4-three-retry-policies-deliberately-different)
5. [Mistyping a metric dimension is a compile error](#5-mistyping-a-metric-dimension-is-a-compile-error)
6. [Send windows that survive daylight saving](#6-send-windows-that-survive-daylight-saving)
7. [Signed one-click unsubscribe](#7-signed-one-click-unsubscribe)
8. [Webhook verification with a replay window](#8-webhook-verification-with-a-replay-window)
9. [A cross-product firewall](#9-a-cross-product-firewall)
10. [A content policy linter that fails the build](#10-a-content-policy-linter-that-fails-the-build)

Plus: [how this is tested](#how-this-is-tested).

---

## 1. One running sequence per contact, enforced by the database

**The problem.** A contact must never be in two sequences at once for the same product, or
they get two emails a day from the same sender. Enrollment can arrive concurrently from a
lead-magnet download, a product API call, and a queue-driven transition. Checking "is there
already a running run?" in application code and then inserting is a classic
time-of-check-to-time-of-use race, and under concurrent enrollment it loses.

**The approach.** Push the invariant into the schema as a partial unique index, so SQLite
rejects the second insert regardless of how the race interleaves.

```ts
// packages/db/src/schema/runs.ts
oneRunningPerContactProductIdx: uniqueIndex('idx_runs_one_running_per_contact_product')
  .on(table.contact_id, table.product_id)
  .where(sql`${table.status} = 'running'`),
```

The `WHERE status = 'running'` clause is what makes it usable: completed, exited, and errored
runs accumulate freely, so a contact's history is preserved while only one run can be live.

Enrollment then treats the constraint violation as an expected outcome rather than an error.
`isRunningRunUniqueConflict` in [apps/api/src/lib/active-run.ts](../apps/api/src/lib/active-run.ts)
recognises the violation by message shape across four historical index names and degrades to
`status: 'already_running'`, so a race returns the existing run instead of a 500.

**Failure prevented.** Two concurrent enrollments producing two live runs, and the contact
receiving double the intended email volume.

[source](../packages/db/src/schema/runs.ts) - [tests](../apps/api/src/__tests__/one-active-run-routes.test.ts)

---

## 2. A rate limiter with no read-modify-write race

**The problem.** Per-client rate limiting needs a counter. `SELECT count`, compare, then
`UPDATE` is two round trips with a window in between where a concurrent request reads the
same value. Under exactly the burst the limiter exists to stop, it lets requests through.

**The approach.** Make the increment itself conditional, and decide allow/deny from whether
the write changed a row.

```sql
UPDATE seq_rate_limit_windows
SET count = count + 1, updated_at = ?
WHERE key = ? AND count < ?
```

If the client is already at the limit, the `WHERE` clause matches nothing, zero rows change,
and the request is denied. There is no separate read to race against. The subsequent `SELECT`
exists only to report `X-RateLimit-Remaining` and never gates the decision.

Windows are fixed and keyed `rl:{clientId}:{endpoint}:{windowStart}`, so no coordination is
needed: a new window is simply a new key. The tradeoff is that expired rows are never removed.
`packages/db/src/schema/rate-limits.ts` defines `idx_rate_limit_windows_expires` on
`window_end_ms` for a reaper, but no reaper was ever written and nothing deletes these rows, so
the table grows without bound. Three tiers are configured: 1000/hour default, 5000/hour for
lead-magnet downloads, and 30/5min for failed authentication.

That last tier is applied on a key built from the sanitised product plus client IP, so
unauthenticated brute-force attempts are throttled separately from legitimate traffic. The
sanitiser clamps to `[a-z0-9_.:-]` and 128 characters specifically to stop a caller from
injecting structure into the key.

**Failure prevented.** A burst of concurrent requests all reading the same pre-increment
count and all being allowed.

[source](../apps/api/src/middleware/rate-limit.ts) - [tests](../apps/api/src/__tests__/product-api-auth.test.ts)

---

## 3. Four independent idempotency layers

Email is the domain where a duplicate is expensive and visible. Four different things can
duplicate, so there are four different mechanisms rather than one general one.

**Client retries.** `POST /api/v1/events` and the lead-magnet download endpoint both accept an
`Idempotency-Key` header, but store it differently. Events turn it into a synthetic
`provider_event_id` of `api:{clientId}:{key}` on the event row. Lead-magnet downloads cache the
prior response in KV under `lead_magnet_download:{clientId}:{slug}:{key}`, because a replay has
to return the same signed asset response, not just a flag. A genuine replay of an event returns
`{ duplicate: true }`. The interesting case
is the *same key with a different body*: that returns `409 idempotency_key_conflict` rather
than silently accepting or silently ignoring, because it means the caller has a bug and
hiding it would make that bug much harder to find.

**Provider webhook redelivery.** Providers retry. A unique index on
`(provider, provider_event_id)` plus `onConflictDoNothing()` makes redelivery a no-op. The
consumer additionally compares payloads: the same event id arriving with *different* content
is logged as an error and dropped rather than overwriting what was already recorded.

**Crash between "recorded" and "applied".** Persisting the raw event and applying its side
effects are separate operations, so a crash in between could double-apply or silently skip.
`side_effects_started_at` and `side_effects_completed_at` (migrations 0019 and 0020) implement
a 10 minute lease over the second half, so a retry after a crash can tell the difference
between "still in flight elsewhere" and "abandoned, safe to redo".

**A step sending twice.** A unique index on `(run_id, step_index)` in `seq_steps` and another
on `seq_messages.step_id` mean a step cannot produce two message rows, even if the Durable
Object's alarm somehow fires twice for the same index.

[events route](../apps/api/src/routes/api/v1/events.ts) - [queue consumer](../apps/api/src/queues/consumer.ts) - [tests](../apps/api/src/__tests__/events-product-scope.test.ts)

---

## 4. Three retry policies, deliberately different

Retry is not one problem, so it does not get one solution.

**Step sends** retry 3 times at 1m, 5m, then 15m, then mark the run `errored` and push to the
dead letter queue. The delays are long because the failure is usually a provider issue, and
retrying a send aggressively risks duplicate delivery. Retries are re-scheduled through the
send-window logic, so a retry cannot escape the contact's allowed hours.

If the dead-letter send *itself* fails, that emits a `dead_letter.failed` metric rather than
being swallowed. The failure of the failure path is the one nobody notices otherwise.

**Queue messages** use the platform's own retry: `max_retries = 3` with a real
`dead_letter_queue` binding, and a first-class recovery tool in `pnpm seq dlq replay`
(with `--dry-run`) so a dead-lettered batch is fixable rather than just observable.

**Transient D1 errors** get a deliberately narrow allowlist. D1 occasionally rejects a valid
statement while its backing storage object restarts. Those are safe to retry; a constraint
violation or a syntax error is not, and retrying it would turn a fast failure into a slow one.

```ts
// apps/api/src/lib/d1-retry.ts
const TRANSIENT_D1_MESSAGE_FRAGMENTS = [
  'caused object to be reset',
  'internal error while starting up d1',
  'network connection lost',
  'reset because its code was updated',
]
```

Four exact fragments, not a catch-all. The module's doc comment states the rule explicitly so
the next person does not "improve" it into `catch { retry }`. `sleep` is injectable so the
backoff can be tested without real delays.

[source](../apps/api/src/lib/d1-retry.ts) - [tests](../apps/api/src/lib/d1-retry.test.ts)

---

## 5. Mistyping a metric dimension is a compile error

**The problem.** Metrics are write-only until you need them. A typo in a dimension name, or a
missing dimension, produces data that looks fine and is useless six weeks later during an
incident.

**The approach.** Model the whole metric surface as a discriminated union, so the event name
determines exactly which dimensions are required.

Reformatted onto single lines from
[apps/api/src/lib/observability.ts](../apps/api/src/lib/observability.ts), and abridged: the
real union has eight members.

```ts
export type MetricEvent =
  | { name: 'send.attempted'; dims: { product: string; sequence: string; step: string; variant: string } }
  | { name: 'send.sent'; dims: { product: string; sequence: string; step: string; variant: string } }
  | { name: 'send.skipped'; dims: { product: string; sequence: string; step: string; reason: string } }
  | { name: 'send.failed'; dims: { product: string; sequence: string; step: string; error: string } }
  | { name: 'dead_letter.failed'; dims: { product: string; sequence: string; step: string; error: string } }
  | { name: 'webhook.received'; dims: { provider: string; event_type: string } }
  // enrollment.created, suppression.applied
```

`trackMetric(analytics, event)` accepts nothing else. Adding a metric means extending the
union, and every call site that needs updating fails to compile.

The structured logger alongside it stamps `git_sha` and `environment` on every line, and its
typed context carries `contact_id_hash` rather than a raw address, so logs stay useful without
becoming a PII store.

[source](../apps/api/src/lib/observability.ts) - [tests](../apps/api/src/__tests__/sentry.test.ts)

---

## 6. Send windows that survive daylight saving

**The problem.** Sends are clamped to 08:00-17:00 in the contact's own timezone. Converting
"09:00 local" to UTC by adding a fixed offset is wrong twice a year, and wrong in a way that
only shows up as emails arriving at 07:00 or 10:00 for part of the year.

**The approach.** The offset for a local time depends on the resulting instant, which itself
depends on the offset. `localDateTimeToUtcMs` resolves that circularity by iterating: guess an
offset, compute the instant, recompute the offset at that instant, repeat. It evaluates the
offset once as an estimate and then three more times in a fixed loop. That is a fixed iteration
count, not a convergence check, and the tests in
[send-window.test.ts](../apps/api/src/lib/send-window.test.ts) only exercise US zones, so
half-hour and 45-minute zones are reasoned about rather than covered.

Per-contact timezone is resolved from `timezone`, `time_zone`, or `tz` properties, with
product-level values overriding global ones, and every candidate is validated through
`Intl.DateTimeFormat` before use so a bad value degrades rather than throws.

**Failure prevented.** Every contact in a DST-observing zone receiving mail an hour outside
the intended window for roughly half the year.

[source](../apps/api/src/lib/send-window.ts)

---

## 7. Signed one-click unsubscribe

RFC 8058 requires a one-click unsubscribe that works without authentication. That means the
endpoint is, by design, reachable by anyone, so the link itself has to carry the proof.

The token is an HMAC-SHA256 over `{product}\n{email}`. The newline is load-bearing: without a
delimiter that cannot appear in either field, `("a", "bc")` and `("ab", "c")` would produce the
same signed content. Email and product are normalised the same way before signing *and* before
verifying, so `Jane@Example.com ` and `jane@example.com` resolve to one identity instead of two
signatures that disagree.

Verification uses a hand-rolled constant-time comparison. The runtime does expose
`crypto.subtle.timingSafeEqual`, but it takes buffers; the values compared here are the
base64url strings, so this compares them directly. It XORs the lengths into the accumulator as
well as the bytes, so an early length mismatch does not short-circuit.

[source](../apps/api/src/lib/unsubscribe-token.ts) - [tests](../apps/api/src/__tests__/unsubscribe-route.test.ts)

---

## 8. Webhook verification with a replay window

Resend signs with the Svix scheme. Verification reconstructs the signed content as
`{msg_id}.{timestamp}.{body}`, imports the secret via WebCrypto, and checks HMAC-SHA256
against every signature in the `v1,...` header, because Svix sends multiple during key
rotation.

The timestamp is checked against a +/- 300 second window. Without it a valid signature is
valid forever, and an attacker who captures one delivery can replay it indefinitely.

Failure modes return distinct statuses rather than a generic 401, because they mean different
things operationally: 500 when the secret is not configured (our bug), 401 for a missing
header, bad timestamp, or bad signature (their problem), 400 for malformed JSON.

[source](../apps/api/src/webhooks/resend.ts)

---

## 9. A cross-product firewall

Several products shared this sequencer and, in some cases, overlapping audiences. A product
can declare a `firewall_partner_id`; a contact already associated with that partner product is
then blocked from enrollment.

It is a small piece of code with an unusual property: it is a business rule that is cheaper to
enforce in the engine than in every calling product, and it is checked inside the Durable
Object before every send rather than only at enrollment, so a contact who becomes a partner's
customer mid-sequence stops receiving mail.

[source](../apps/api/src/lib/firewall.ts)

---

## 10. A content policy linter that fails the build

The most unusual gate in the repo. `pnpm seq compile` does not only validate structure; it
enforces a cadence and content policy, and a violation stops the build.

```ts
// scripts/seq/lib/sequence-policy.ts
const TARGET_TOUCH_COUNT = 14
const SELFISH_SUBJECT_PATTERN =
  /\b(did you|get a chance|checking in|check-in|quick check|quick .*setup pass|last call|ready to|just following|follow up|following up|bumping)\b/i
```

Every sequence must be exactly 14 touches, the first landing by day 1, each subsequent touch
exactly one day after the last, all inside 14 days. Steps with id `resource` (lead-magnet
delivery) are exempt from the count and window checks, but their delay still accumulates into
the schedule, so exempting a step cannot be used to smuggle in a gap.

The subject-line regex bans the "just checking in" class of filler outright. Encoding an
editorial standard as a build gate is arguable, and the regex only catches the exact phrases
listed, but it moves a quality bar out of someone's head and into a check that runs on every
compile.

Floating point comparison uses an explicit `DAY_EPSILON = 0.05` rather than exact equality,
because delays are parsed from strings like `24h` and `1d` that do not always produce
identical millisecond totals.

[source](../scripts/seq/lib/sequence-policy.ts) - [tests](../scripts/seq/__tests__/)

---

## How this is tested

**1,747 tests across 149 files** in the main suite, plus 14 Workers-runtime system tests.

There is no CI in this repository, so it is worth being precise about which of the checks below
are automatic. [scripts/deploy-production.mjs](../scripts/deploy-production.mjs) runs, in order:
`seq compile`, `wrangler whoami`, a `seq diff` drift check against production D1, `pnpm build`,
`pnpm test:system`, a `wrangler deploy --dry-run`, `seq readiness --remote --pre-sync`, the real
deploy, `seq sync --remote`, and `seq readiness --remote` again. It aborts on the first failure.
It does not run `pnpm test` or `pnpm test:web:coverage`. Everything in this section other than
the system tests was therefore run by hand.

**Workers-runtime system tests.** [vitest.system.config.ts](../vitest.system.config.ts) uses
`@cloudflare/vitest-pool-workers` to boot the real Workers runtime against the actual
`wrangler.toml`, with real D1, R2, KV, Queue, and Durable Object bindings, and loads the real
migration files through `readD1Migrations`. The suite exercises a scheduled Durable Object
alarm producing a persisted send, a Resend delivery event travelling through the exported
`queue` handler, and the exported `scheduled` backup handler. The runtime and the bindings are
real rather than stubbed; the secrets and the Cloudflare Access team name are test values
injected by the config, so anything downstream of Resend or of a real Access tenant is still
out of scope.

**Migration integrity.** [migrations.test.ts](../packages/db/src/__tests__/migrations.test.ts)
asserts the journal, SQL files, and snapshots stay 1:1, that snapshots form a linear chain,
that every unique index is preceded by a dedupe step, and that the expand-migrate-contract
migrations preserved the rows they claimed to.

**Per-file coverage threshold.** [vitest.web.config.ts](../vitest.web.config.ts) sets
`perFile: true` with 95% statements, branches, and lines and 90% functions across
`apps/web/src`. Per-file rather than aggregate is the point: a global threshold lets a
well-tested module carry an untested one. It runs under `pnpm test:web:coverage`, which is a
local command, not a deploy step.

**Config and docs are drift-tested.** `wrangler-config.test.ts` fails if a real Cloudflare
resource identifier is ever committed. `scripts/seq/__tests__/*-doc.test.ts` read actual
documentation files and fail when they go stale, which is why several operational docs in this
repo cannot quietly rot. Both are part of `pnpm test`, so they catch drift on the next local
run rather than at deploy time.
