# The sequence DSL

Sequences are authored as YAML in `sequences/<product>/<slug>.yaml`, validated and compiled by
the `seq` CLI, then synced into D1. The Durable Object reads the synced definition from D1 at
every alarm, so what runs in production is always something that was explicitly published,
never whatever happens to be in the working tree.

This repository contains 121 sequence definitions totalling 1,695 steps across two products.

- [A complete example](#a-complete-example)
- [Schema reference](#schema-reference)
- [The cadence policy](#the-cadence-policy)
- [The `seq` CLI](#the-seq-cli)

## A complete example

```yaml
slug: floriva-web-fulfillment-welcome
product: floriva-web
version: 2
goal: activate_account
exit_conditions:
  - event: replied
  - event: unsubscribed
enroll:
  trigger: signup
steps:
  - id: welcome
    delay: 0m
    template: onboarding/floriva-web-welcome
    subject: Welcome to Floriva
  - id: resource
    delay: 1d
    skip_if:
      replied: true
    template: nurture/floriva-web-resource
    subject: Your period app privacy checklist
  # ...thirteen more touches
```

Reading it: enrollment happens on a `signup` event. The first email goes out immediately
(`0m`). The second goes out one day later, unless the contact has already replied. The whole
run terminates early if a `replied` or `unsubscribed` event arrives.

## Schema reference

Validation is a single Zod schema, `SequenceDefinitionSchema` in
[packages/shared/src/index.ts](../packages/shared/src/index.ts). It lives in the shared package
rather than in the CLI, but the CLI is its only runtime consumer today: `seq compile` parses
every YAML file through it and `seq diff` parses definitions read back out of D1. The
`SequenceDefinition` type it infers goes further, and is what the `definition` column in
`packages/db/src/schema/sequences.ts` and the Durable Object are declared as. HTTP request
bodies are validated by separate schemas in the same file (`UpsertContactSchema`,
`EnrollmentRequestSchema`, and so on), and the SDK re-exports only the `ProductSlug` type.

### Sequence

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `slug` | string | yes | Unique across every product, not just within one: `seq compile` tracks slugs in a single map and rejects a duplicate. Conventionally prefixed with the product. |
| `product` | enum | yes | Must be a known product slug. A typo fails the build rather than creating an orphan. |
| `version` | positive integer | yes | Bumped on any change. The Durable Object refuses to send if the definition version changed mid-run. |
| `goal` | string | no | Free text, used for reporting. e.g. `book_demo_call`, `activate_account`. |
| `exit_conditions` | array of `{ event }` | no | Any of these events terminates the run. |
| `enroll.trigger` | string | no | The event that starts this sequence, e.g. `signup`, `lead_magnet_download`. |
| `enroll.lead_magnet` | string | no | Ties the sequence to a lead magnet slug for fulfillment. |
| `variants` | array of `{ id, weight }` | no | Weighted A/B variants, `weight` 0-100. Supported by the runtime; unused by the sequences in this repo. |
| `steps` | array | yes | At least one. |

### Step

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Unique within the sequence. Also the metric dimension for this touch. |
| `delay` | string | yes | Matches `^\d+(m\|h\|d)$`, e.g. `0m`, `2h`, `5d`. **Relative to the previous step**, not to enrollment. |
| `template` | string | yes | Template slug, resolved against the template catalog. |
| `subject` | string or map | yes | A map allows per-variant subjects keyed by variant id. |
| `skip_if` | map | no | Conditions that skip this step without ending the run. |

Two things the schema does not let you express, on purpose:

**Absolute send dates.** Delays are always relative and accumulate. That keeps a sequence
correct regardless of when a contact enrolls, and it is what lets the cadence linter reason
about the whole schedule statically.

**Arbitrary send times.** The step says when relative to the previous one; the runtime decides
the actual instant, clamped to the contact's 08:00-17:00 local window. An author cannot
accidentally schedule mail for 3am in someone else's timezone.

## The cadence policy

Beyond schema validation, `pnpm seq compile` enforces a cadence and content policy, and a
violation fails the build. Source:
[scripts/seq/lib/sequence-policy.ts](../scripts/seq/lib/sequence-policy.ts).

**Cadence rules**

- Exactly **14 touches** per sequence.
- The first touch lands by **day 1** (day 0 for welcome or lead-magnet delivery sequences).
- Every subsequent touch lands **exactly one day** after the previous one.
- All 14 land within **14 days**.
- Comparisons use an explicit `DAY_EPSILON = 0.05`, because delays parsed from `24h` and `1d`
  do not always produce identical millisecond totals.

**The `resource` exemption.** Steps with id `resource` are lead-magnet delivery, which sits
outside the nurture cadence. They are excluded from the touch count and the day-window checks,
but their delay still accumulates into the running schedule. That distinction matters: it means
marking a step `resource` cannot be used to smuggle a gap into an otherwise-daily cadence.

**Banned subject lines.** A regex rejects the "selfish reminder" class outright:

```text
did you | get a chance | checking in | check-in | quick check |
quick .*setup pass | last call | ready to | just following |
follow up | following up | bumping
```

Those are the complete alternatives, rewrapped across lines. In the source they are one
case-insensitive pattern with `\b` word boundaries at each end.

Encoding an editorial standard as a build gate is unusual. It exists because this is exactly
the kind of quality bar that erodes silently when it lives only in a style guide.

## The `seq` CLI

`pnpm seq <command>`. Twelve subcommands, implemented in
[scripts/seq/commands/](../scripts/seq/commands/). Most have their own test file. On top of
those, `cli-command-coverage.test.ts` drives the real `diff` and `readiness` commands end to end
through `parseAsync` with `node:child_process` mocked, so the wrangler-shelling and process-exit
paths are exercised rather than stubbed. It does not check that every registered command is
tested; three of the twelve have no dedicated test file.

### Authoring

```bash
pnpm seq compile              # validate schema + cadence policy, write dist/sequences.json
pnpm seq compile --no-bundle  # validate only
pnpm seq dry-run <slug>       # render the full step table without sending
pnpm seq dry-run <slug> --email someone@example.com   # render with a contact's context
```

### Publishing

```bash
pnpm seq diff <slug>          # working tree vs the ACTIVE production definition in D1
pnpm seq diff <slug> --local   # ...vs local D1
pnpm seq diff --check          # exit non-zero on any drift, for use as a gate
pnpm seq sync                 # upsert compiled definitions into local D1
pnpm seq sync --remote        # ...into production D1, recording the git sha per row
```

`diff` exists because the working tree is not the source of truth for what is running. A
sequence can be edited in the dashboard, and a definition can be synced from a different
branch. Comparing against D1 rather than against git is the only way to answer "what will
actually change".

### Operations

```bash
pnpm seq rot                  # active sequences with no enrollments in a window (default 90d)
pnpm seq rot --days 30
pnpm seq readiness            # production readiness gate
pnpm seq readiness --remote   # ...also checks remote D1 rows and deployed Worker secrets

# --source, --account-id and --queue-id are all required
pnpm seq dlq replay --source dlq.json --account-id <id> --queue-id <id> --dry-run
pnpm seq dlq replay --source dlq.json --account-id <id> --queue-id <id>
```

`--dry-run` validates the captured messages without pushing; without it they go back onto
events-queue, using the Cloudflare API token named by `--api-token-env` (default
`CLOUDFLARE_API_TOKEN`).

### Provisioning helpers

```bash
pnpm seq token-sql            # emit seq_api_tokens seed SQL
pnpm seq secret-template      # emit a `wrangler secret bulk` JSON template
pnpm seq secret-template --missing-remote   # ...diffed against the deployed Worker
pnpm seq access-token-template
pnpm seq lead-magnet-sql
pnpm seq lead-magnet-assets   # emit R2 verification commands for required assets
```
