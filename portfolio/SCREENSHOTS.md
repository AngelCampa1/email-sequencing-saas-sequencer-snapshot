# Screenshots

41 captures of the operator dashboard: 34 desktop at 1440x900 and 7 mobile at 390x844, all at
2x device pixel ratio.

Every image was produced by [scripts/dev/capture-screenshots.mjs](../scripts/dev/capture-screenshots.mjs)
against a local `wrangler dev --local` Worker with `ENVIRONMENT=development`, seeded by
[scripts/dev/seed-local-contacts.sql](../scripts/dev/seed-local-contacts.sql). To regenerate the
whole set:

```bash
pnpm build
pnpm db:migrate:local
pnpm seq compile && pnpm seq sync
pnpm seed:dev
cd apps/api && pnpm exec wrangler dev --local --port 8799
# then, in another shell
pnpm screenshots
```

The data is synthetic. See [Notes on the data](#notes-on-the-data) at the bottom, which is
worth reading before drawing conclusions from any number in these images.

---

## Overview

<table>
<tr>
<td width="33%"><a href="screenshots/desktop/01-overview.png"><img src="screenshots/desktop/01-overview.png" alt="Four stat cards, the stale-sequence warning banner, and the top active sequences table." /></a></td>
<td width="33%"><a href="screenshots/desktop/02-overview-loading.png"><img src="screenshots/desktop/02-overview-loading.png" alt="Skeleton state, captured by holding the API response open." /></a></td>
<td width="33%"><a href="screenshots/desktop/03-overview-error.png"><img src="screenshots/desktop/03-overview-error.png" alt="The QueryError state after the request fails past its retries." /></a></td>
</tr>
<tr>
<td align="center">Overview</td>
<td align="center">Loading</td>
<td align="center">Error</td>
</tr>
</table>

## Sequences

<table>
<tr>
<td width="25%"><a href="screenshots/desktop/07-sequences.png"><img src="screenshots/desktop/07-sequences.png" alt="All 121 synced sequences with product and status filters." /></a></td>
<td width="25%"><a href="screenshots/desktop/08-sequences-detail-dialog.png"><img src="screenshots/desktop/08-sequences-detail-dialog.png" alt="A compiled sequence expanded to its 14-step schedule. This is the DSL made visible." /></a></td>
<td width="25%"><a href="screenshots/desktop/09-sequences-edit-dialog.png"><img src="screenshots/desktop/09-sequences-edit-dialog.png" alt="Editing a sequence." /></a></td>
<td width="25%"><a href="screenshots/desktop/10-sequences-new-dialog.png"><img src="screenshots/desktop/10-sequences-new-dialog.png" alt="Creating a sequence." /></a></td>
</tr>
<tr>
<td align="center">All sequences</td>
<td align="center">Detail dialog</td>
<td align="center">Edit dialog</td>
<td align="center">New dialog</td>
</tr>
</table>

## Contacts

<table>
<tr>
<td width="33%"><a href="screenshots/desktop/11-contacts.png"><img src="screenshots/desktop/11-contacts.png" alt="Paginated contact table with product and active-sequence filters." /></a></td>
<td width="33%"><a href="screenshots/desktop/12-contacts-search.png"><img src="screenshots/desktop/12-contacts-search.png" alt="Search by name or email." /></a></td>
<td width="33%"><a href="screenshots/desktop/13-contacts-empty-search.png"><img src="screenshots/desktop/13-contacts-empty-search.png" alt="The empty state for a search with no matches." /></a></td>
</tr>
<tr>
<td align="center">Contact table</td>
<td align="center">Search</td>
<td align="center">Empty search</td>
</tr>
<tr>
<td width="33%"><a href="screenshots/desktop/14-contacts-detail-sheet.png"><img src="screenshots/desktop/14-contacts-detail-sheet.png" alt="The contact sheet: product memberships, active sequence and step, and the full message timeline." /></a></td>
<td width="33%"><a href="screenshots/desktop/15-contacts-new-dialog.png"><img src="screenshots/desktop/15-contacts-new-dialog.png" alt="Creating a contact." /></a></td>
<td width="33%"><a href="screenshots/desktop/16-contacts-delete-alert.png"><img src="screenshots/desktop/16-contacts-delete-alert.png" alt="Destructive confirm, as an alert dialog." /></a></td>
</tr>
<tr>
<td align="center">Detail sheet</td>
<td align="center">New dialog</td>
<td align="center">Delete alert</td>
</tr>
</table>

## Lead Magnets

<table>
<tr>
<td width="25%"><a href="screenshots/desktop/17-lead-magnets.png"><img src="screenshots/desktop/17-lead-magnets.png" alt="Mixed asset and follow-up states: fully wired, no file yet, and no follow-up email." /></a></td>
<td width="25%"><a href="screenshots/desktop/18-lead-magnets-new-dialog.png"><img src="screenshots/desktop/18-lead-magnets-new-dialog.png" alt="Creating a lead magnet." /></a></td>
<td width="25%"><a href="screenshots/desktop/19-lead-magnets-edit-dialog.png"><img src="screenshots/desktop/19-lead-magnets-edit-dialog.png" alt="Editing a lead magnet." /></a></td>
<td width="25%"><a href="screenshots/desktop/20-lead-magnets-row-selection.png"><img src="screenshots/desktop/20-lead-magnets-row-selection.png" alt="Row selection with the bulk action toolbar." /></a></td>
</tr>
<tr>
<td align="center">Lead magnets</td>
<td align="center">New dialog</td>
<td align="center">Edit dialog</td>
<td align="center">Row selection</td>
</tr>
</table>

## Block list

<table>
<tr>
<td width="25%"><a href="screenshots/desktop/21-suppressions-global.png"><img src="screenshots/desktop/21-suppressions-global.png" alt="Global suppressions. The tab labels carry live counts." /></a></td>
<td width="25%"><a href="screenshots/desktop/22-suppressions-product.png"><img src="screenshots/desktop/22-suppressions-product.png" alt="Product-scoped suppressions, the other half of the two-scope model." /></a></td>
<td width="25%"><a href="screenshots/desktop/23-suppressions-block-dialog.png"><img src="screenshots/desktop/23-suppressions-block-dialog.png" alt="Blocking an address, with scope selection." /></a></td>
<td width="25%"><a href="screenshots/desktop/24-suppressions-unblock-alert.png"><img src="screenshots/desktop/24-suppressions-unblock-alert.png" alt="Unblock confirmation." /></a></td>
</tr>
<tr>
<td align="center">Global</td>
<td align="center">Product-scoped</td>
<td align="center">Block dialog</td>
<td align="center">Unblock alert</td>
</tr>
</table>

## Templates

<table>
<tr>
<td width="50%"><a href="screenshots/desktop/25-templates.png"><img src="screenshots/desktop/25-templates.png" alt="The template catalog with per-template usage counts, derived from the synced sequences." /></a></td>
<td width="50%"><a href="screenshots/desktop/26-templates-preview-dialog.png"><img src="screenshots/desktop/26-templates-preview-dialog.png" alt="The preview dialog rendering the real email HTML through the actual renderer, in a sandboxed iframe." /></a></td>
</tr>
<tr>
<td align="center">Template catalog</td>
<td align="center">Preview dialog</td>
</tr>
</table>

## Deliverability

<table>
<tr>
<td width="50%"><a href="screenshots/desktop/27-deliverability.png"><img src="screenshots/desktop/27-deliverability.png" alt="Domain health with inline SVG sparklines, and cold campaign stats. Complaint rates above threshold render in red." /></a></td>
<td width="50%"><a href="screenshots/desktop/28-deliverability-assign-dialog.png"><img src="screenshots/desktop/28-deliverability-assign-dialog.png" alt="Assigning a cold campaign to a product." /></a></td>
</tr>
<tr>
<td align="center">Deliverability</td>
<td align="center">Assign dialog</td>
</tr>
</table>

## Audit Log

<table>
<tr>
<td width="50%"><a href="screenshots/desktop/29-audit.png"><img src="screenshots/desktop/29-audit.png" alt="Every mutating dashboard action, with actor, filterable by action and date range." /></a></td>
<td width="50%"><a href="screenshots/desktop/30-audit-row-expanded.png"><img src="screenshots/desktop/30-audit-row-expanded.png" alt="A row expanded to its before/after payload." /></a></td>
</tr>
<tr>
<td align="center">Audit log</td>
<td align="center">Row expanded</td>
</tr>
</table>

## Products

<table>
<tr>
<td width="33%"><a href="screenshots/desktop/04-products.png"><img src="screenshots/desktop/04-products.png" alt="The tenant list: brand colour, sender identity, suppression scope, firewall partner." /></a></td>
<td width="33%"><a href="screenshots/desktop/05-products-new-dialog.png"><img src="screenshots/desktop/05-products-new-dialog.png" alt="Creating a product." /></a></td>
<td width="33%"><a href="screenshots/desktop/06-products-delete-dialog.png"><img src="screenshots/desktop/06-products-delete-dialog.png" alt="Deleting a product, gated on nothing else referencing it." /></a></td>
</tr>
<tr>
<td align="center">Products</td>
<td align="center">New dialog</td>
<td align="center">Delete dialog</td>
</tr>
</table>

## Settings

<table>
<tr>
<td width="33%"><a href="screenshots/desktop/31-settings.png"><img src="screenshots/desktop/31-settings.png" alt="Product API tokens, Resend configuration, and observability links." /></a></td>
<td width="33%"><a href="screenshots/desktop/32-settings-cf-setup-expanded.png"><img src="screenshots/desktop/32-settings-cf-setup-expanded.png" alt="The searchable Cloudflare provisioning commands, with copy buttons." /></a></td>
<td width="33%"><a href="screenshots/desktop/33-settings-token-dialog.png"><img src="screenshots/desktop/33-settings-token-dialog.png" alt="Registering an Access service token against a product." /></a></td>
</tr>
<tr>
<td align="center">Settings</td>
<td align="center">Cloudflare setup</td>
<td align="center">Token dialog</td>
</tr>
</table>

## Not found

<table>
<tr>
<td width="33%"><a href="screenshots/desktop/34-not-found.png"><img src="screenshots/desktop/34-not-found.png" alt="The SPA catch-all route." /></a></td>
</tr>
<tr>
<td align="center">404</td>
</tr>
</table>

---

## Mobile

The sidebar collapses to a wrapped navigation bar below the `md` breakpoint.

<table>
<tr>
<td width="33%"><a href="screenshots/mobile/m01-overview.png"><img src="screenshots/mobile/m01-overview.png" alt="Overview page on mobile, cards stacked in a single column." /></a></td>
<td width="33%"><a href="screenshots/mobile/m02-sequences.png"><img src="screenshots/mobile/m02-sequences.png" alt="Sequences list on mobile." /></a></td>
<td width="33%"><a href="screenshots/mobile/m03-contacts.png"><img src="screenshots/mobile/m03-contacts.png" alt="Contacts list on mobile." /></a></td>
</tr>
<tr>
<td align="center">Overview</td>
<td align="center">Sequences</td>
<td align="center">Contacts</td>
</tr>
<tr>
<td width="33%"><a href="screenshots/mobile/m04-contacts-detail-sheet.png"><img src="screenshots/mobile/m04-contacts-detail-sheet.png" alt="Contact detail sheet on mobile." /></a></td>
<td width="33%"><a href="screenshots/mobile/m05-suppressions.png"><img src="screenshots/mobile/m05-suppressions.png" alt="Block list on mobile." /></a></td>
<td width="33%"><a href="screenshots/mobile/m06-templates-preview-dialog.png"><img src="screenshots/mobile/m06-templates-preview-dialog.png" alt="Template preview dialog on mobile." /></a></td>
</tr>
<tr>
<td align="center">Contact sheet</td>
<td align="center">Block list</td>
<td align="center">Template preview</td>
</tr>
<tr>
<td width="33%"><a href="screenshots/mobile/m07-settings.png"><img src="screenshots/mobile/m07-settings.png" alt="Settings page on mobile." /></a></td>
<td width="33%"></td>
<td width="33%"></td>
</tr>
<tr>
<td align="center">Settings</td>
<td></td>
<td></td>
</tr>
</table>

---

## Notes on the data

Everything in these images comes from the local dev seed. Being specific about what that means:

**All contacts are invented.** Addresses use RFC 2606 reserved domains (`example.com` and
subdomains of it), which cannot resolve to a real organisation. No customer data of any kind
appears in this repository.

**"Stale Sequences: 10" is correct, not a bug.** The rot query is `LIMIT 10`. A local database
has all 121 sequences synced but only a handful of seeded enrollments, so nearly every sequence
qualifies as stale and the card reports the capped count. In production that number was small
because most sequences had recent sign-ups.

**The seed uses relative timestamps.** Rows are written with
`strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-N days')` rather than fixed dates, so the Overview's
7 and 30 day windows are always populated no matter when the seed runs. That is also why
regenerating the gallery produces slightly different numbers each time. Regenerate the set as a
whole rather than replacing individual images, or the numbers will disagree across shots.

**The volume is deliberately padded.** 60 generated contacts sit behind the 5 named ones, so
the contacts table paginates and the derived rates have a believable denominator. With only
five contacts a single unsubscribe would render as a 20% unsubscribe rate.

**Dark mode is absent because the app has none.** `apps/web/src/index.css` is a single
`@import "tailwindcss"` with no theme block and no `dark:` variants anywhere in the codebase.
The dashboard was built light-mode only.
