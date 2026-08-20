# Documentation index

This folder holds the **working** documents — the ones written forward, to a future self, while
the system was being built. Runbooks, rollout audits, config inventories, design notes.

The **retrospective** documents, written for a reader evaluating the engineering, are one level
up in [`portfolio/`](../portfolio/).

## Start here — in `portfolio/`

| Document | What it covers |
| --- | --- |
| [../portfolio/ARCHITECTURE.md](../portfolio/ARCHITECTURE.md) | System topology, the lifecycle of one email, the Durable Object state machine, the data model, and background work. Four diagrams. |
| [../portfolio/ENGINEERING-LOG.md](../portfolio/ENGINEERING-LOG.md) | Ten pieces of the codebase that were harder than they look, each with the failure it prevents and the test that pins it. Plus the testing strategy. |
| [../portfolio/METRICS.md](../portfolio/METRICS.md) | Every number in the README, with the command that produces it. |
| [../portfolio/SEQUENCE-DSL.md](../portfolio/SEQUENCE-DSL.md) | The YAML sequence format, the cadence policy that gates the build, and the twelve-command `seq` CLI. |
| [../portfolio/SCREENSHOTS.md](../portfolio/SCREENSHOTS.md) | 41 captures of the operator dashboard, and an honest account of what the seeded data does and does not represent. |

## Provenance

| Document | What it covers |
| --- | --- |
| [source-history.json](source-history.json) | Where this snapshot came from: source commit, commit count, date range, authors, what was withheld from the export and what was added for publication. |

## API

| Document | What it covers |
| --- | --- |
| [api/README.md](api/README.md) | What is in this folder, plus the auth headers and base URLs. |
| [api/curl-examples.md](api/curl-examples.md) | Curl examples for 6 of the 10 `/api/v1/*` endpoints and the one-click unsubscribe link. Not a full reference. |
| [product-client-integration.md](product-client-integration.md) | How a product backend authenticates: Access service tokens mapped to products through `seq_api_tokens`. |

## Operations

| Document | What it covers |
| --- | --- |
| [deploy.md](deploy.md) | Production deployment, from first-time Cloudflare setup through cutover. |
| [operations-playbook.md](operations-playbook.md) | Daily health checks, incident procedures, dead-letter recovery, emergency stop. |
| [workers-alerts.md](workers-alerts.md) | Cloudflare alert configuration. |
| [production-config-values.md](production-config-values.md) | The two classes of production configuration and how each is applied. |

## Rollout records

| Document | What it covers |
| --- | --- |
| [product-rollout-readiness.md](product-rollout-readiness.md) | Gates cleared before enabling Sequencer calls from a live product. |
| [product-rollout-audit.md](product-rollout-audit.md) | Rollout audit scope and findings. |
| [live-product-sequencer-cutover-audit.md](live-product-sequencer-cutover-audit.md) | Cutover audit. |
| [lead-magnet-product-assets-audit.md](lead-magnet-product-assets-audit.md) | Lead-magnet asset manifest reconciliation. |

## Design

| Document | What it covers |
| --- | --- |
| [design/2026-06-23-dashboard-qol.md](design/2026-06-23-dashboard-qol.md) | A design document written before the dashboard quality-of-life work, kept as a record of the reasoning. |

---

## Why the operational documents are still here

Several files above look like the kind of thing a repository accumulates and never prunes:
rollout audits, config value inventories, asset manifests. They are kept deliberately, because
they are **asserted on by the test suite**.

`scripts/seq/__tests__/rollout-audit-doc.test.ts`, `production-config-doc.test.ts`, and
`lead-magnet-assets-audit-doc.test.ts` read these files and fail when their content drifts out
of sync with the code. `text-encoding.test.ts` additionally enforces an ASCII-punctuation
convention across the operational set, so a copy-pasted em dash or arrow cannot break a
terminal or a Windows shell rendering the runbook.

Deleting any of them breaks `pnpm test`. That is the intended design: documentation that can
rot silently generally does, so the parts that operators depend on were wired into the same
gate as the code.
