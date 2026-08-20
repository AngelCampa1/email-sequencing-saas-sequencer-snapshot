# Portfolio documents

Seven documents written for a reader who did not build this and is deciding, in about five
minutes, whether the engineering is any good. They are retrospective. They describe the system
as it ran, not as anyone intended it to run, and they say where it fell short.

Everything here is checkable against the tree. Every claim links to the file it came from, and
every number has the command that produced it.

| Document | Length | Covers |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 262 lines | Topology, one email's lifecycle, the DO state machine, the data model, background work |
| [SECURITY.md](SECURITY.md) | 162 lines | Three auth surfaces, the enroll + in-DO suppression check, per-product Resend key isolation, token limits |
| [ENGINEERING-LOG.md](ENGINEERING-LOG.md) | 345 lines | Ten hard problems, the failure each prevents, the test that pins it, plus testing gaps |
| [TESTING.md](TESTING.md) | 338 lines | What the suite protects (double-send guards, suppression, webhook verification) and its gaps |
| [SEQUENCE-DSL.md](SEQUENCE-DSL.md) | 183 lines | The YAML sequence format, the cadence policy gate, and the `seq` CLI |
| [METRICS.md](METRICS.md) | 119 lines | Every README number, with the command and definition behind it |
| [SCREENSHOTS.md](SCREENSHOTS.md) | 263 lines | 41 dashboard captures, and what the seeded data does and doesn't show |

This folder holds the seven retrospective documents indexed above, each addressed to a reader
evaluating the engineering. The day-to-day build record (plans, deployment runbooks, rollout
audits, design notes) lives unedited in [`docs/`](../docs/): `portfolio/` is written to you,
`docs/` was written to me.

## On the honesty of the numbers

There was no CI. Nothing in a pipeline enforced the coverage gate, the test suite, or the lint
rules on this repository: the gates ran locally and inside a guarded deploy script, and the
deploy script is the only one that was mandatory. [METRICS.md](METRICS.md) says which figures
are re-derivable from this snapshot and which depend on the private history it was cut from.
Where a number cannot be checked from what you can see, it says so instead of asking you to
trust it.
