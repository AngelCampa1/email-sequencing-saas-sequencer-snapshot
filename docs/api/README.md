# Sequencer API notes

There is no exported request collection in this folder. It holds two files:

- [curl-examples.md](curl-examples.md) - runnable curl commands for the most-used product API
  calls. It is a starting point, not a full reference: it covers 6 of the 10 endpoints mounted
  under `/api/v1/*`, plus the unauthenticated one-click unsubscribe link, and none of the
  internal dashboard endpoints.
- This file.

For the full route list, read the mounts in `apps/api/src/index.ts`. For how a product backend
authenticates, read [../product-client-integration.md](../product-client-integration.md).

## Authentication

Product API calls use Cloudflare Access Service Tokens:

- Header: `CF-Access-Client-Id: <client_id>`
- Header: `CF-Access-Client-Secret: <client_secret>`

## Base URL

- Local: http://127.0.0.1:8799, using the `wrangler dev` command in the root README
- Production: https://sequencer.ventoralabs.com

Every product endpoint is mounted twice, under `/api/v1/*` and under `/api/client/v1/*`. The
two paths route to the same handlers.
