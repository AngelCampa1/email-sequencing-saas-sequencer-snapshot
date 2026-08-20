# Goal: Publication-Ready Snapshot — Provenance, Build, Documentation Accuracy

> Verify this snapshot is what it claims to be and safe to stand behind before it goes public:
> the export is provably the right one, `pnpm install` works from a clean clone, every figure
> in the README is real, and the hero image represents the product rather than an unflattering
> accident of seed data. This track is an audit and correction pass over a snapshot that
> already existed — not a rebuild.

## Method

1. Confirm provenance by arithmetic against the tracked tree, not by trusting the export note.
2. Reproduce the documented "run it locally" path from a clean state
   (`pnpm install --frozen-lockfile`) rather than assuming the lockfile is current.
3. Re-derive every quantitative claim in the README from the committed metrics script and from
   independent greps of the schema, and correct any that disagree.
4. Check the hero image and its caption against what the screenshot actually shows and what the
   seed data actually is.

## Cycle log

### Cycle 1 — 2026-08-13 — Verification pass

- Ran `pnpm install --frozen-lockfile`: completes cleanly with no resolution step. It did not
  before — see FIND-01.
- Ran `node scripts/dev/portfolio-metrics.mjs` and cross-checked its output against an
  independent `grep` over `packages/db/src/schema/` and a re-read of the README: 28,702 LOC
  source / 40,192 LOC test, the 1.40:1 ratio, and 30 declared indexes (18 plain, 12 unique) all
  match what's committed. See FIND-02.
- Recomputed the provenance arithmetic in `docs/source-history.json` against the actual tree:
  `git ls-files | wc -l` returns 599, not the 594 that file's own formula (551 − 7 + 50)
  produces. See FIND-03.
- Confirmed the README hero is `portfolio/screenshots/desktop/27-deliverability.png`
  (Deliverability page) rather than an Overview screenshot with a warning banner and a column
  of zeros, and that both its caption and the intro of `portfolio/SCREENSHOTS.md` state plainly
  that the numbers are local seed data, not production traffic.

## Findings registry

(P0 = broken/blocking · P1 = looks bad or confusing · P2 = polish)

- **FIND-01 (P0, FIXED)** — `pnpm install --frozen-lockfile` failed outright on the exported
  tree: the lockfile didn't match `package.json`. That's the first command in the README's own
  "Run it locally" section, so it would have failed for the first person who tried it.
  Regenerated the lockfile against the committed manifests. Verified: a clean
  `pnpm install --frozen-lockfile` now finishes in under 2 seconds with the lockfile reported
  up to date.
- **FIND-02 (P1, FIXED)** — The README overstated three figures: 34 indexes where the schema
  declares 30, 25,973 LOC where the committed source is actually 28,702, and a 1.55:1
  test-to-source ratio where it's actually 1.40:1. All three were stale hand counts. Replaced
  every quantitative claim in the README with output from a committed script,
  `scripts/dev/portfolio-metrics.mjs`, and added `portfolio/METRICS.md`, which states the exact
  command behind each number plus the three figures (commit history, author count, production
  send volume) that cannot be checked from this snapshot at all and says so rather than
  guessing. Verified independently: an out-of-band `grep` for `uniqueIndex(`/`index(` across
  `packages/db/src/schema/` returns 30, matching the script and the README exactly.
- **FIND-03 (RETRACTED — provenance count corrected)** — The brief for this cycle offered
  "551 source files − 7 withheld + 50 added = 594" as the arithmetic proving this is a valid
  `sequencer` export. The arithmetic is internally consistent but doesn't match the tree:
  `git ls-files | wc -l` returns 599, five more than the 594 that formula produces — a real
  gap in `docs/source-history.json`'s own reconciliation, not a rounding artifact (confirmed
  twice: once via the raw count, once by summing tracked files per top-level directory).
  Correcting to the verifiable number: **599 tracked files**, not 594. Everything else in the
  provenance claim still checks out independently — the directory layout, the `seq_*` table
  prefix, and the 121 sequences / 1,695 steps all match what the README describes — so this
  looks like a bookkeeping gap in one number, not evidence of the wrong export. I can't tell
  from this tree alone which of the three inputs (551 source, 7 withheld, 50 added) is off;
  that needs the private repository this was exported from. Left `docs/source-history.json`
  unedited — it's a provenance record, not a README figure, and out of scope without that
  access. Needs the owner.

  **RESOLVED, 2026-08-14.** The comparison the reviewer could not run has now been run against
  the source repository, and the reviewer's instinct was right: the count of *added* files was
  the wrong input. `551 source` is correct and `7 withheld` is correct — both were verified
  file-for-file, and the seven match the categories `source-history.json` already describes.
  The additions were **56**, not 50: the original enumeration silently omitted the `LICENSE`,
  `docs/README.md`, the replacement design doc, `source-history.json` itself, and this ledger.
  `551 − 7 + 56 = 600`, which is what `git ls-files | wc -l` returns.

  Note the reviewer's 599 was also correct **when it was measured** — this ledger file was
  added afterwards, making it 600. A self-referential count is a moving target: the document
  recording the number changes the number. All four sources now agree at 600 —
  `git ls-files`, `scripts/dev/portfolio-metrics.mjs`, `portfolio/METRICS.md`, and
  `docs/source-history.json` — and the METRICS figure is the script's output, so it stays
  correct by construction rather than by hand.
- Hero image: confirmed swapped to `portfolio/screenshots/desktop/27-deliverability.png` — no
  warning banner, no column of zeros — with a caption stating plainly that the numbers are
  local seed data, not production traffic, echoed at the top of `portfolio/SCREENSHOTS.md`. No
  action needed; recorded because it was one of the items this cycle set out to verify.

### Cycle 2 — 2026-08-18 — Portfolio-standard alignment pass

- Applied `PORTFOLIO-STANDARD.md` to this repo. Restructured `README.md` into the required
  heading set and order: added `## Contents`, `## If you read one thing`,
  `## Built with AI agents`, `## Known gaps`, `## Who built this`, and `## License`; converted
  the "It is dead" prose into a `> [!IMPORTANT]` status alert; added a `> [!NOTE]` byline and
  license teaser near the top; renamed `## Scale and shape` to `## By the numbers`,
  `## Run it locally` to `## Running it locally`, `## Repository layout` to
  `## Repository map`, and `## What this is` to `## What it did`, correcting its tense to past
  throughout. See FIND-04.
- Collapsed `## Documentation` in the root README from a full two-table reprint to two
  sentences and two links, per spec section 1.6 — the file-by-file index now lives only in
  `portfolio/README.md` and `docs/README.md`, not duplicated in the root README.
- Renamed `portfolio/ENGINEERING.md` to `portfolio/ENGINEERING-LOG.md` per the spec's
  name-resolution table and updated every reference (`README.md`, `portfolio/README.md`,
  `docs/README.md`). Checked first that no test or script referenced the old filename. File
  count unaffected: `git ls-files | wc -l` still returns 600 after the rename.
- Converted `portfolio/SCREENSHOTS.md`'s eleven desktop sections and the mobile section from
  one-image-per-row markdown tables to an HTML `<table>` grid (2-4 columns per row), preserving
  full descriptive alt text on every image rather than shortening it for the grid. Verified
  independently: every one of the 41 files under `portfolio/screenshots/` is referenced exactly
  once in `portfolio/SCREENSHOTS.md`, and every reference resolves to a file that exists (a
  diff of referenced paths against `ls` output on both `desktop/` and `mobile/` was empty).
- Fixed a stale figure: the root README said "fifty added for publication" (implying
  551 − 7 + 50 = 594), but `docs/source-history.json` and this ledger's own Cycle 1 resolution
  both say 56 added, 600 total. Corrected to "fifty-six" in the new `## What it did` section.
  See FIND-05.
- Tagged the two remaining untagged fences in the repository — `portfolio/SEQUENCE-DSL.md`'s
  banned-subject-line block and the repository-map tree in `README.md` — both now `text`. A
  full sweep of every `.md` file under `docs/` and `portfolio/` found no other untagged fences.
- Re-ran the four-source file-count check: `git ls-files` (600), `portfolio/METRICS.md` (600),
  `docs/source-history.json` (600), this ledger (600). Still agree after the rename and the
  README restructure, since neither changed the number of tracked files.
- Left `docs/` untouched beyond the two reference updates above (`docs/README.md`'s
  `ENGINEERING.md` link). It is already the smallest and tidiest `docs/` folder in the
  portfolio and none of its 14 files needed pruning.

## Findings registry (Cycle 2)

- **FIND-04 (P1, FIXED)** — `README.md` was missing six of the spec's required headings
  (`Contents`, `If you read one thing`, `Built with AI agents`, `Known gaps`, `Who built this`,
  `License`) and stated its dead/archived status as plain prose rather than the required
  `> [!IMPORTANT]` alert. Restructured per `PORTFOLIO-STANDARD.md` section 1.2. Checked the
  tense of `## What it did` against the status alert afterward: both past tense, no mismatch.
- **FIND-05 (P1, FIXED)** — `README.md`'s own body still said "fifty added for publication",
  contradicting `docs/source-history.json` (56 added) and this ledger's own FIND-03 resolution
  from Cycle 1. Corrected to fifty-six.
- **FIND-06 (P2, not fixed — flagged for the owner, not altered)** —
  `portfolio/screenshots/desktop/04-products.png`, `31-settings.png` and
  `32-settings-cf-setup-expanded.png` show the operator's real sender addresses on his own
  product domains. The third was missed when this finding was first written and found by a
  later review that checked all 41 captures rather than only the two already named. `docs/source-history.json`'s `sanitized`
  field already discloses this accurately and was left as-is; re-verified the wording still
  matches what the three images show. The images themselves were left in place, per instruction —
  this is a pending decision for the repository owner, not a documentation defect.

### Cycle 3 — 2026-08-18 — Added portfolio/SECURITY.md

- Wrote `portfolio/SECURITY.md`, covering four things verified directly from source: the three
  authentication surfaces on the Worker (`/api/v1/*` via CF Access service tokens, `/api/internal/*`
  and `/me` via CF Access with a Google IdP plus a hardcoded email allowlist, `/webhooks/*` via
  Svix HMAC or a shared secret) and why each is separate; the suppression check that runs both at
  enrollment (`enrollments.ts`) and again inside `SequenceRunDO` before every send
  (`sequence-run.ts`), and why the second check is deliberate rather than redundant; per-product
  Resend key isolation via `seq_products.resend_api_key_secret_name`; and what `seq_api_tokens`
  cannot do, verified against its own schema (`id`, `product_id`, `label`,
  `access_service_token_id`, `created_at`, `revoked_at` — no column capable of carrying a
  broader credential). Every file and line-number citation was checked against the tree with
  `sed -n` before being written down, not carried over from memory. Closed with a "Boundaries
  that are partial" section naming four specific limits (hardcoded allowlist, env-var-gated dev
  bypass, time-window-only webhook replay protection, D1-based rather than network-layer rate
  limiting) rather than implying the auth story has no edges. No audit, certification, or
  penetration test is claimed anywhere in the document, because none happened.
- Added `portfolio/SECURITY.md` to `portfolio/README.md`'s index table and updated its intro
  from "Five documents" to "Six documents". Also corrected `SCREENSHOTS.md`'s length in that
  same table from 154 to 263 lines, which had gone stale after Cycle 2's HTML-table conversion
  and was missed at the time.
- Adding a file changes the publication count, so re-ran the four-source check with the new
  total: `portfolio/SECURITY.md` is a 162-line addition, taking the snapshot from 600 to **601**
  tracked files (551 source − 7 withheld + 57 added, up from 56). Updated
  `docs/source-history.json` (`filesInSnapshot`, the `difference` field, and "six portfolio
  documents" → "seven"), `portfolio/METRICS.md`'s "Files tracked in total" row, and both places
  in `README.md` that stated the old figure ("fifty-six added" → "fifty-seven"; the `By the
  numbers` table row). Left the Cycle 1 and Cycle 2 log entries above unedited — they are a
  record of what was true when each cycle ran, and 600 was the correct count at those points.

### Cycle 4 — 2026-08-18 — Added portfolio/TESTING.md

- Wrote `portfolio/TESTING.md`, the last required `portfolio/` file that was missing per
  `PORTFOLIO-STANDARD.md` section 2.1. Read the real test infrastructure before writing anything:
  the three Vitest configs (`vitest.config.ts`, `vitest.web.config.ts`,
  `vitest.system.config.ts`), every `__tests__`/`system-tests` directory, and the test-title lists
  inside the largest files, rather than restating the counts already in `METRICS.md` and
  `ENGINEERING-LOG.md`. Reconciled the file-count arithmetic independently (79 `apps/web` test
  files + 70 elsewhere = 149, matching the `pnpm test` figure exactly, with the one
  `system-tests` file excluded and counted separately as the 14 Workers-runtime tests) rather
  than taking the existing 1,747/149/14 figures on faith.
- The document's spine is what the codebase's own hard problem — not sending an email twice —
  is actually proven by, at three layers (the partial unique index on running runs, the DO's
  pre-send message-row check, and provider webhook redelivery dedupe), each with the specific
  test title that proves it, not just the file it lives in.
- Found and documented two real, specific gaps by reading test bodies rather than titles: (1)
  `checkSuppression` is mocked at every one of its six call sites across the test suite — the
  gate placement is proven everywhere, but the function's own KV-then-D1 read logic has no test
  against real KV or D1 anywhere in the tree, including the one Workers-runtime system test,
  which never seeds a suppression row; (2) the Resend webhook route's signature-rejection branch
  and both providers' "secret not configured" 500 branch have no test — every Resend webhook test
  signs its payload with a valid HMAC first, so `401 Invalid signature` is unreached code as far
  as the suite is concerned. Also corrected my own draft error before it shipped: an early pass
  linked `ENGINEERING-LOG.md#4-four-independent-idempotency-layers` for its "Four independent
  idempotency layers" section, which is actually `#3-...` — caught by writing a small script that
  extracts every heading in a target file, computes its GitHub-style anchor, and checks every
  `#anchor` link against that list, rather than checking by eye. Ran it against `TESTING.md`
  itself (52 links, all resolve) and, separately, a full link-and-anchor pass against `README.md`
  (79 links) and `portfolio/README.md` (9 links) after editing them, both clean.
- Added `portfolio/TESTING.md` to `portfolio/README.md`'s index table (placed after
  `ENGINEERING-LOG.md`, its natural companion) and updated the intro from "Six documents" to
  "Seven documents". Linked it from `README.md`'s `## Testing` section.
- Adding a file changes the publication count again: `portfolio/TESTING.md` is a 338-line
  addition, taking the snapshot from 601 to **602** tracked files (551 source − 7 withheld + 58
  added, up from 57). Updated `docs/source-history.json` (`filesInSnapshot`, the `difference`
  field, and "seven portfolio documents" → "eight"), `portfolio/METRICS.md`'s "Files tracked in
  total" row, and both places in `README.md` that stated the old figure ("fifty-seven added" →
  "fifty-eight"; the `By the numbers` table row). Left the Cycle 1 through 3 log entries above
  unedited — they are a record of what was true when each cycle ran, and 600/601 were the
  correct counts at those points.

### Cycle 5 — 2026-08-18 — Mobile-width fix, lead-magnets gallery check, error-copy residue check

- `portfolio/README.md`'s doc-index table overflowed at 375px: the prose-heavy middle column
  pushed the `Length` column and its seven values off the right edge. Shortened every row in
  that column (also shortening the header from "What it covers" to "Covers", matching the
  header CapVeri already uses for the same table) without dropping any claim the longer wording
  made — e.g. `SECURITY.md`'s row still names all three things it covers (auth surfaces,
  suppression check, per-product key isolation) plus token scope, just without the sentence
  padding. See FIND-07.
- Checked `portfolio/screenshots/desktop/17-lead-magnets.png` (2 of 3 rows in a red "File
  missing" state) against every other capture that touches the Lead Magnets table:
  `18-lead-magnets-new-dialog.png` and `19-lead-magnets-edit-dialog.png` are dialogs over a
  blurred background and don't show the table at all; `20-lead-magnets-row-selection.png` shows
  the same three rows with the same two "File missing" states, just with checkboxes ticked.
  There is no mobile capture of this page either. No healthy-state capture of Lead Magnets
  exists anywhere in `portfolio/screenshots/`. See FIND-08 — left the image and its caption
  exactly as they were; nothing was swapped or re-captioned.
- Checked whether "boom" (the sub-text in `03-overview-error.png`'s error banner) is a literal
  in the product source. It is not in `apps/web/src` or `apps/api/src` application code — the
  banner's sub-text is `formatQueryError(error)` in `apps/web/src/components/ui/query-error.tsx`,
  which echoes whatever `error.message` the API call actually returned, not a hardcoded string.
  "boom" itself lives in two places, neither of which ships: `scripts/dev/capture-screenshots.mjs`
  (the dev tool that mocks a `500 {"error":"boom"}` response specifically to manufacture this
  screenshot) and several `__tests__`/`*.test.ts(x)` files that use it as a generic mock error
  message. See FIND-09.
- Re-ran the relative-link and `#anchor` resolution check against `portfolio/README.md` after
  the table edit: all 9 links resolve, no anchors broken (the table edit touched only prose
  cells, not any file path or link).
- No document under `portfolio/` changed line count this cycle (only `portfolio/README.md`'s
  own table prose changed, and none of the seven other files' line counts moved), so the
  `Length` column values already in the index table needed no numeric update — re-verified with
  `wc -l` against all seven anyway, per instruction, and they still match.

## Findings registry (Cycle 5)

- **FIND-07 (P2, FIXED)** — `portfolio/README.md`'s doc-index table required horizontal scroll
  at 375px to see the `Length` column, because the "Covers" cells ran up to 206 characters of
  prose. Shortened all seven rows and the header. Not independently pixel-verified against a
  real 375px viewport (no browser available in this pass) — verified by eye against the
  comparably-dense table in the CapVeri snapshot's `portfolio/README.md`, which was reviewed
  clean at the same width.
- **FIND-08 (P2, checked — no fix available)** — `17-lead-magnets.png` is the only capture of
  the Lead Magnets table (desktop or mobile) that isn't obscured by a dialog, and it shows 2 of
  3 seeded rows in a "File missing" error state. Confirmed no other capture in the repository
  shows this feature healthy. This is accurate to the seeded data and already disclosed as such
  in `SCREENSHOTS.md`'s alt text, so left unchanged — a real healthy capture would need a fresh
  screenshot pass against seed data with a valid R2 asset attached, which is outside this pass's
  scope.
- **FIND-09 (—, checked, not a defect in shipped code)** — "boom" in `03-overview-error.png` is
  cosmetic dev-tooling residue, not application source: it is injected by
  `scripts/dev/capture-screenshots.mjs` when manufacturing the error-state screenshot, and
  separately appears as a throwaway mock string in several unit tests. `apps/web`'s actual error
  rendering path displays whatever message the API returns; nothing in shipped `apps/web/src` or
  `apps/api/src` hardcodes "boom". Recorded here per instruction; no source change made or
  needed.

### Cycle 6 — 2026-08-18 — Corpus-wide index column order, and a non-conforming length cell

- The cross-repo standard fixed `portfolio/README.md`'s index table column order as link,
  length, summary — length second, not last. This repo's table had
  `Document | Covers | Length`, length last.
- Reordered to `Document | Length | Covers`; all seven rows and the alignment row updated.
- Found `METRICS.md`'s length cell reading "this repo, regenerable" instead of a bare
  `N lines` value the standard requires for mechanical checking — verified `wc -l` against the
  file (119 lines) and replaced the prose with `119 lines`.
- Recomputed every length cell against `wc -l` after both edits: all seven rows match exactly.
- Ran a relative-link and `#anchor` resolution sweep over `README.md` and every
  `portfolio/*.md` file: all resolve.
