# Sequencer Dashboard — Quality-of-Life Improvements (Design)

Date: 2026-06-23
Branch: `worktree-dashboard-qol`
Scope decision: **Everything** (all three value tiers, all 10 pages)

## Problem

The dashboard is read-heavy: nearly every page renders a table, but the tables
lack the basic controls a daily operator needs. The trigger was Contacts having
no product filter, but the gap is systemic — most tables have no sorting, no
pagination UI, no per-column filters, no export, and no bulk actions, even where
the API already supports the underlying query params.

## Goals

Bring every dashboard table up to a consistent baseline:

1. **Filtering** — product filter everywhere a product column exists; status /
   type / scope filters where meaningful; audit-log filtering by actor/action/date.
2. **Sorting** — clickable, accessible column-header sorting on every table.
3. **Pagination** — real pagination UI wired to existing `limit`/`offset` (Contacts,
   Suppressions) and consistent page controls on the already-paged Audit log.
4. **Search** — broaden Contacts search beyond email (name); add search to
   Templates, Lead Magnets, Suppressions, Deliverability, Settings, Products.
5. **Export** — CSV export on every list table.
6. **Bulk actions** — row selection + batch operations where a per-row action
   already exists (Suppressions unblock, Lead Magnets activate/deactivate).
7. **Drill-downs & polish** — clickable rows (Overview→Sequence, Templates→Sequence),
   Deliverability trend sparklines, Settings batch-copy, consistent empty/loading states.

## Non-Goals

- No redesign of the visual language, navigation, or page layouts.
- No new entities or write surfaces beyond batching existing per-row actions.
- No real-time/websocket updates; manual refetch + existing query staleness only.

## Architecture

### Principle: shared primitives first

Every page currently rolls its own `<table>`. Rather than a heavyweight DataTable
abstraction (high churn, high risk), we add **small composable primitives** that
each page opts into incrementally. This keeps diffs reviewable and lets us land
pages independently.

New shared modules under `apps/web/src/components/ui/` and `apps/web/src/lib/`:

| Module | Purpose |
|---|---|
| `lib/use-sortable-data.ts` | Hook: takes rows + column accessors, returns sorted rows + `sort` state + `toggleSort(key)`. Client-side, stable, tri-state (asc→desc→none). |
| `components/ui/sortable-header.tsx` | `<SortableHeader sortKey field state onToggle>` — accessible `<th>` with `aria-sort`, chevron indicator, button semantics. |
| `components/ui/table-pagination.tsx` | `<TablePagination page pageSize total hasMore onPrev onNext onPageSize>` — page N of M, prev/next, page-size select. Works for offset-based and "hasMore" cursoring. |
| `components/ui/product-filter.tsx` | `<ProductFilter value onChange products includeAll>` — standard product dropdown built from the products query (with orphaned-id fallback, matching SequencesPage today). |
| `components/ui/toolbar.tsx` | `<TableToolbar>` layout wrapper: search slot + filter slots + right-aligned actions (export, refresh). |
| `components/ui/data-export.tsx` | `<ExportButton rows columns filename>` + `lib/csv.ts` `toCsv(rows, columns)`. Pure, no deps. |
| `components/ui/row-select.tsx` | `useRowSelection(ids)` hook + `<SelectAllCheckbox>`/`<RowCheckbox>` + `<BulkActionBar>` sticky footer. |
| `components/ui/sparkline.tsx` | Tiny inline SVG sparkline for Deliverability domain trends. No chart lib. |

All primitives are presentational + hook-based, unit-testable in isolation, and
themed with existing Tailwind tokens. Buttons use the canonical `rounded-full`
pill (per repo rule).

### Data flow

- **Client-side primitives** (sort, CSV export, row selection) operate on already-
  fetched arrays — no API change, no new query keys.
- **Server-side params** (pagination, product filter, search, audit filters) extend
  existing TanStack Query hooks. Query keys gain a params object, e.g.
  `['contacts', { q, product, limit, offset }]`. URL search params mirror filter
  state so views are shareable/back-button-safe (Suppressions already does this for
  tabs — we generalize with a small `useUrlState` helper).

### API changes (`apps/api/src/routes/internal/`)

| Endpoint | Change |
|---|---|
| `GET /contacts` | Add `product` (slug) filter; broaden `q` to match name OR email. Keep `limit`/`offset`. Return `total` for pagination. |
| `GET /templates` | Wire existing `product` param through to the response (already filtered server-side; expose to client). |
| `GET /audit` | Add `actor`, `action`, `targetType`, `from`, `to` filters; return `total`. |
| `GET /suppressions` | Return `total` alongside rows for pagination UI; add optional `q` email filter and `source` filter. |
| `GET /deliverability` | Add optional `q`/`status`/`product` for campaigns; domain history for sparklines (last N days per domain) — if cheap; else compute client-side from existing rows. |
| `GET /contacts` name search | Requires confirming the contacts schema has a name column (it does — Name column renders). |

Each endpoint keeps backward-compatible defaults (absent param = current behavior).

### Testing

Per repo rules: **TDD, 95% coverage on touched files.**

- Primitives: pure unit tests (Vitest) — sort ordering, CSV escaping, pagination
  math, selection set logic, product-option derivation.
- API handlers: handler tests asserting new params filter/shape correctly and that
  omitting params preserves current behavior (regression guard).
- Pages: component tests for filter→query wiring where practical; otherwise rely on
  primitive coverage + manual verification via the running app.

## Delivery phases

Each phase is independently shippable and reviewed (`/code-review` pre-merge).

1. **Foundation** — all shared primitives + their unit tests. No page wiring yet.
2. **Contacts** — product filter (API+UI), name search, pagination, sorting, export.
   This directly closes the reported gap.
3. **Server-param pages** — Suppressions (pagination, search, bulk unblock, export),
   Audit (filters, export), Templates (product filter via API, search, sort, export).
4. **Client-only pages** — Sequences, Lead Magnets (sort, search, filters, export,
   bulk activate), Products (search, sort, filters), Settings (search, sort,
   batch-copy commands).
5. **Drill-downs & viz** — Overview top-sequences clickable + Deliverability
   sparklines + Templates→Sequence links + empty/loading-state consistency.

## Risks

- **Coverage on large page components** — mitigate by pushing logic into tested
  hooks/primitives so page files stay thin.
- **API filter regressions** — every new param defaults to no-op; regression tests
  assert unchanged behavior when params absent.
- **Scope size** — phased, independently-mergeable; can pause between phases.
