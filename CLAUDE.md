# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ventora Sequencer

Centralized email sequence management hub for all live Ventora products (camaudit, floriva-web).

## Stack
- **Frontend**: Vite SPA (React 19 + React Router 7 + TanStack Query + Tailwind v4 + Shadcn)
- **API**: Cloudflare Workers (Hono) - single Worker with `fetch`, `queue`, and `scheduled` handlers
- **DB**: Cloudflare D1 (Drizzle ORM); all tables prefixed `seq_*`
- **State machine**: `SequenceRunDO` Durable Object (one per enrollment) driven by `alarm()`
- **Queue**: Cloudflare Queues (`events-queue`, `dead-letter-queue`)
- **Cache**: Cloudflare KV (`SUPPRESSIONS`, `SESSIONS`)
- **Storage**: Cloudflare R2 (`ASSETS_BUCKET`, `LOGS_BUCKET`)
- **Metrics**: Workers Analytics Engine (`sequencer_metrics`)
- **Auth**: Cloudflare Access (Zero Trust) - Google IdP, operator@example.com
- **Email send**: Resend (one API key secret *per product*, named `RESEND_API_KEY_<PRODUCT>`)
- **Cold stats**: Instantly (read-only, hourly sync)

## Repo Layout
- `apps/api` - Hono Worker. Entry: [apps/api/src/index.ts](apps/api/src/index.ts).
- `apps/web` - Vite SPA built into `apps/web/dist` and served as Worker assets by the production Worker.
- `packages/db` - Drizzle schema + client. Schema files in [packages/db/src/schema/](packages/db/src/schema/), migrations in `packages/db/migrations/`.
- `packages/shared` - types shared between Worker, SPA, and CLI (e.g. `SequenceDefinition`).
- `packages/sdk` - JS SDK used by other Ventora products to call `/api/v1/*`.
- `packages/emails` - React Email templates and layouts.
- `scripts/seq` - `seq` CLI (compile/diff/dry-run/rot) for YAML sequences.
- `sequences/<product>/*.yaml` - source-of-truth sequence definitions; compiled and synced to D1 before production deploy.
- `docs/` - `deploy.md`, `operations-playbook.md`, `workers-alerts.md`, `api/curl-examples.md`.

## Architecture

**Three auth/API surfaces on the same Worker** ([apps/api/src/index.ts](apps/api/src/index.ts)):
1. `/api/v1/*` - product-facing API (contacts, enrollments, events, unsubscribe, lead-magnets). Authenticated via **CF Access Service Tokens** (`CF-Access-Client-Id`/`Secret` headers). Cloudflare Access must protect this path; the Worker maps the verified service-token client id (`*.access`) to a product.
2. `/api/internal/*` and `/me` - dashboard backend, gated by **CF Access** Google IdP (Zero Trust).
3. `/webhooks/{resend,instantly}` - provider callbacks. HMAC-verified, then enqueued to `EVENTS_QUEUE` for async processing.

**Sequence runtime**: Enrollment creates a `SequenceRunDO` (apps/api/src/durable-objects/sequence-run.ts) keyed by `runId`. The DO loads the synced `SequenceDefinition`, schedules the next step via `state.storage.setAlarm()`, and on wake: checks suppressions + any configured product firewall, picks a variant, renders the template, sends via Resend, persists to `seq_messages`/`seq_events`, then sets the next alarm. Exit conditions (`replied`, `unsubscribed`, custom events) are delivered through `POST /event` to the DO, which advances or terminates the run.

**Sequence pipeline**: YAML in `sequences/<product>/<slug>.yaml` -> `pnpm seq compile` validates definitions -> `pnpm seq sync --remote` writes active definitions to D1 -> `pnpm deploy:prod` ships the Worker after readiness passes. Use `pnpm seq diff <slug>` to compare the working tree against the active production D1 definition before deploying (`--local` checks local D1). The DO reads the synced definition from D1 for step execution.

**Cron triggers** (declared in [apps/api/wrangler.toml](apps/api/wrangler.toml), dispatched from [apps/api/src/crons/index.ts](apps/api/src/crons/index.ts)): hourly Instantly stats sync, daily domain-health rollup (03:00), rot detector (03:30), D1 -> R2 backup marker (04:00).

## Key Commands
```bash
pnpm dev                      # web (vite) + api (wrangler dev --local) in parallel
pnpm test                     # vitest, all packages (uses workspace aliases - see vitest.config.ts)
pnpm test -- <path>           # single file: pnpm test -- apps/api/src/__tests__/do-engine.test.ts
pnpm test:watch               # watch mode
pnpm build                    # build packages then apps
pnpm seq compile              # validate + compile YAML sequences
pnpm seq diff <slug>          # diff working tree vs active production D1
pnpm seq dry-run <slug>       # preview without sending
pnpm seq rot                  # show inactive sequences
pnpm setup:cf                 # print CF resource setup commands

# DB
pnpm drizzle-kit generate     # generate migration from schema diff
pnpm exec wrangler d1 migrations apply sequencer-db --local --config apps/api/wrangler.toml
pnpm exec wrangler d1 migrations apply sequencer-db --remote --config apps/api/wrangler.toml

# Deploy
pnpm apply:prod-config:dry-run # validate filled dist secrets/token files before applying config
pnpm apply:prod-config         # upload Worker secrets, insert seq_api_tokens, then run readiness
pnpm deploy:prod:dry-run       # non-mutating compile/readiness/deploy dry-run
pnpm deploy:prod               # compile, sync, readiness, build, and deploy
pnpm deploy:prod:migrate       # apply remote D1 migrations first, then guarded deploy
```

## Conventions
- Workspace aliases: `@sequencer/{db,emails,sdk,shared}` - defined in [pnpm-workspace.yaml](pnpm-workspace.yaml) and re-aliased for tests in [vitest.config.ts](vitest.config.ts). Use them in imports; never reach across packages with relative paths.
- All D1 tables are prefixed `seq_` (e.g. `seq_products`, `seq_contacts`, `seq_sequence_runs`).
- Per-product Resend secrets follow `RESEND_API_KEY_<PRODUCT_UPPER>`; the secret name to use is stored on `seq_products.resend_api_key_secret_name`.
- Suppression check happens both at enrollment and inside the DO before each send - never skip in the DO path.
- `seq_api_tokens` maps verified Cloudflare Access service-token client ids (`*.access`) to products. It is not for Worker deploys, D1, KV, R2, Queues, or storage access.

## Rules
- TDD mandatory, 95% coverage on touched files
- All dev work in git worktrees, never on `main` directly
- Pre-merge `/review` before every merge
- Conventional commits
- Shadcn/UI for all components
- **Buttons are pills** — all buttons in the SPA use fully-rounded pill shape (`rounded-full`). This is canonical. Update the shadcn `Button` base variant to use `rounded-full`; do not add per-instance overrides.

## AI Agent Orchestration

AI agent instances operating in this repository are orchestrators. They must delegate exploration, implementation, verification, and other execution work to sub-agents whenever the work can be cleanly scoped, preserving the orchestrator's context window for coordination, integration, and final judgment.

## User-Facing Copy Guardrails

This repo ships marketing email copy (`packages/emails`, `sequences/`). Run any
user-facing copy through these guardrails before calling the work done. Applies to
email bodies and subject lines, product UI text, CTAs, onboarding copy, help text,
empty states, and anything that sells, explains, persuades, activates, or reassures.

Required order:

1. Run the `humanizer` skill to remove AI-sounding, bloated, or generic copy.
2. Run the `third-grade-copy` skill to rewrite and audit the result for a third-grade reading level.
3. Verify there are zero lies: no made-up numbers, claims, proof, testimonials, guarantees, rankings, integrations, prices, timelines, or capabilities. Check claims against the product source of truth before publishing.
4. Verify the message fits the whole place it appears: the page, flow, audience, offer, brand voice, surrounding copy, and user intent. Do not approve a line just because it is clear in isolation.

Note that both skills are installed globally, outside this repository.

Do not apply this rule to code identifiers, logs, API docs, technical docs for developers, exact legal text, database values, or user-generated content unless the user asks.

## Working autonomously
- **Poll, don't idle.** When a task, build, test run, or hook is running, actively poll its status and output until it finishes. Don't just sit and wait passively for it to return.
- **Keep going.** When working toward a goal, finishing one chunk of work means moving straight to the next chunk. Don't stop and wait for further input mid-goal — continue until the goal is done or you are genuinely blocked.
