# Metrics

Every number quoted in [the README](../README.md), with the command that produces it. If a
figure here and a figure there ever disagree, this file is wrong and the command is right.

Run them all at once:

```bash
node scripts/dev/portfolio-metrics.mjs
```

That script is [scripts/dev/portfolio-metrics.mjs](../scripts/dev/portfolio-metrics.mjs). It
reads `git ls-files`, so it measures what is committed, not what is lying around in a working
directory.

## Definitions first

The definitions are most of the meaning, so they are stated before the numbers.

- **source**: tracked `.ts`/`.tsx` that is not a test and not a generated `.d.ts`.
- **test**: tracked `.ts`/`.tsx` under `__tests__/` or `system-tests/`, or named `*.test.ts(x)`.
- **LOC**: newline count. The same thing `wc -l` reports. Blank lines and comments included;
  this is a size measure, not a productivity one.

Type-escape counts are **source-only**. Test code is allowed to lie to the type system to build
a fixture, production code is not, so counting them together would flatter the source. The
figures for test code are reported separately at the bottom of the script's output rather than
folded in.

## Code size

| | |
| --- | --- |
| Application TypeScript | **28,702 LOC** across 156 files |
| Test code | **40,192 LOC** across 151 files |
| Test-to-source ratio | **1.40:1** |
| `@ts-expect-error` in source | 0 |
| `as any` in source | 6 |
| `Record<string, any>` in source | 13 |

`as any` and `Record<string, any>` are not lint-banned: `noExplicitAny` is off in
[biome.json](../biome.json), which is a deliberate choice rather than an oversight. Every
remaining instance sits at a raw D1 row or a provider-response boundary, where the value really
is unknown until it is validated. The number is published because an unenforced convention is
only worth anything if someone counts it.

Test code holds 5 more `as any` and both of the repository's 2 `@ts-expect-error`.

## Content

| | |
| --- | --- |
| YAML sequences | **121**, totalling **1,695** steps |
| D1 tables | 21 |
| Database migrations | 33 |
| Indexes declared in schema | **30** (18 plain, 12 unique) |
| Screenshots | 41 |
| Files tracked in total | 602 |

The index count is the number declared in
[packages/db/src/schema/](../packages/db/src/schema/), which is the schema that actually
shipped. Counting `CREATE INDEX` statements across the migration files instead gives 38, because
migrations record history: indexes that were created, then dropped or replaced by a later
migration, are still in that total. 30 is what exists; 38 is what happened.

Not included in the LOC figures above: 2 generated `.d.ts` files, 33 `.sql` migrations, 121
`.yaml` sequences, 41 `.png` screenshots. That is a lot of real content the code-size numbers
say nothing about, which is why the script prints the exclusions every time it runs.

## Tests and coverage

These come from running the suites, not from counting files.

```bash
pnpm test              # 1,747 passing across 149 files
pnpm test:system       # 14 Workers-runtime system tests
pnpm test:web:coverage # per-file gate
```

| | |
| --- | --- |
| Tests | **1,747 passing** across 149 files |
| Dashboard coverage | **99.58%** statements, **98.43%** branches, **97.51%** functions |
| Coverage gate | **per file**, at 95 / 95 / 90, not a repository average |

The per-file part is the load-bearing part. A repository average lets a well-tested module pay
for an untested one; a per-file gate does not, and it is the reason the branch number is a real
constraint rather than a rounding artefact.

Both figures above were re-run against **this snapshot**, after the sanitisation described in
[docs/source-history.json](../docs/source-history.json), so they describe the tree you are
looking at rather than a private ancestor of it.

## History, authorship, and production volume

Two of these figures trace to the private repository this snapshot was cut from; the third is
withheld by design.

| | | |
| --- | --- | --- |
| History | **698 commits**, 2026-05-11 to 2026-07-13 | Private repository. Recorded in [docs/source-history.json](../docs/source-history.json) |
| Authors | 4 identities, one person plus one agent identity | Same |
| Production sends | **not published** | No volume, recipient count or revenue figure appears anywhere in this repository, because none of it can be verified from the tree |

That last row is the important one. This system sent real mail for two live products, and how
much is exactly the kind of number a portfolio repository is tempted to invent. It is left out.

## CI

**None.** No pipeline enforced any of the above.

Two sets of gates existed and only one was automatic:
[scripts/deploy-production.mjs](../scripts/deploy-production.mjs) ran `seq compile`, a
`wrangler whoami` check, a `seq diff` drift check against production D1, `pnpm build`,
`pnpm test:system`, a `wrangler deploy --dry-run`, and `seq readiness --remote`, aborting on
the first failure. Everything else (`pnpm test`, the coverage gate, `pnpm lint:ci`) ran when
someone remembered to run it.

Read the coverage and test numbers with that in mind. They are high, and they were maintained
by hand.
