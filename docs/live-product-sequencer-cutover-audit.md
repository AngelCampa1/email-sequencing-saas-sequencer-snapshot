# Live Product Sequencer Cutover Audit

## Current Live Products

| Product | Status | Notes |
| --- | --- | --- |
| `camaudit` | Live | Sequencer-managed sequences and lead magnets remain active. |
| `floriva-web` | Live | Sequencer-managed lead-magnet downloads use product-owned R2 assets and enroll `floriva-web-lead-magnet-nurture`. |

## Removed Products

The shutdown products were removed from this Sequencer system: CapVeri, Lextract, GatherGrove, GeoLeap, SkillLedger, Kaiplan, PebbleDesk, Gavelhouse, PHIGuard, and GrantPipe.

Removal covers source sequence directories, live product validation, readiness live products, required Resend secrets, product R2 bindings, required lead magnet manifests, email branding/template exports, and production cleanup migrations through `0032_remove_grantpipe`.

Sequencer-managed lead-magnet downloads use product-owned R2 assets only for the remaining live products.
