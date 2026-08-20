# Sequencer API - Curl Examples

Base URL: https://sequencer.ventoralabs.com

## Authentication

```bash
# Set these for all requests:
CLIENT_ID="your_cf_access_client_id"
CLIENT_SECRET="your_cf_access_client_secret"
BASE="https://sequencer.ventoralabs.com"
```

## Contacts

```bash
# Upsert contact
curl -X POST $BASE/api/v1/contacts \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","first_name":"Jane","product":"camaudit"}'

# Get contact timeline
curl $BASE/api/v1/contacts/user%40example.com \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET"
```

## Enrollments

```bash
curl -X POST $BASE/api/v1/enrollments \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","sequence_slug":"camaudit-cam-reconciliation-checklist","source":"landing_page"}'
```

## Events

```bash
curl -X POST $BASE/api/v1/events \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","event":"booked_demo","product":"camaudit"}'
```

## Unsubscribe

```bash
# Via API
curl -X POST $BASE/api/v1/unsubscribe \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","product":"camaudit","scope":"product"}'

# One-click link from email footer, no auth needed. Cloudflare Access must bypass /unsubscribe.
curl "$BASE/unsubscribe?email=user@example.com&product=camaudit"
```

## Lead Magnets

```bash
curl -X POST $BASE/api/v1/lead-magnets/cam-reconciliation-checklist/download \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","first_name":"Jane","utm":{"source":"google","campaign":"cam_checklist"}}'
```
