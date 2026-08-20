# Ventora Sequencer - Workers Alerts Configuration

Configure these alerts in the Cloudflare dashboard:
**Workers & Pages -> sequencer-api-production -> Notifications**

## Alert 1: High Send Failure Rate
- **Metric**: Error rate
- **Threshold**: > 5 errors/minute for 2 consecutive minutes
- **Notification**: Email to operator@example.com

## Alert 2: Webhook Error Spike
- **Trigger**: `/webhooks/*` returns 5xx at rate > 1% over 10 minutes
- **Notification**: Email

## Alert 3: Worker CPU Time Alert
- **Threshold**: P99 CPU time > 30ms sustained for 5 minutes
- **Notification**: Email

## Analytics Engine Queries

Run these in Workers Analytics Engine.

### Send failure rate (last 1 hour)
```sql
SELECT blob1 as event, count() as total
FROM sequencer_metrics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
AND blob1 IN ('send.failed', 'send.sent', 'send.skipped')
GROUP BY blob1
ORDER BY total DESC
```

### Suppression rate by product (last 24 hours)
```sql
SELECT blob3 as product, count() as total
FROM sequencer_metrics
WHERE timestamp > NOW() - INTERVAL '24' HOUR
AND blob1 = 'suppression.applied'
GROUP BY blob3
ORDER BY total DESC
```

### Enrollment by sequence (last 7 days)
```sql
SELECT blob3 as sequence, count() as enrollments
FROM sequencer_metrics
WHERE timestamp > NOW() - INTERVAL '7' DAY
AND blob1 = 'enrollment.created'
GROUP BY blob3
ORDER BY enrollments DESC
LIMIT 10
```

`trackMetric` writes `blob1` as the metric name and appends dimensions in the order declared by
the event. For `suppression.applied`, `blob2` is scope and `blob3` is product. For
`enrollment.created`, `blob2` is product, `blob3` is sequence, and `blob4` is source.

## Logpush Configuration

Set up in Cloudflare Dashboard -> **Workers & Pages -> sequencer-api-production -> Logpush**:

1. Create a Logpush job -> destination: R2 bucket `sequencer-logs`
2. Fields to include: timestamp, outcome, scriptName, requestUrl, requestMethod, responseStatus, cpuTime, wallTime, logs
3. Frequency: Every 60 seconds
4. Path prefix: `logs/{DATE}/`
5. Retention: 90 days (configure in R2 lifecycle rules)

## R2 Lifecycle Rules for Log Retention

In Cloudflare Dashboard -> R2 -> sequencer-logs -> Settings -> Object Lifecycle:
- Rule: Delete objects older than 90 days in prefix `logs/`
- Rule: Keep `backups/` indefinitely
