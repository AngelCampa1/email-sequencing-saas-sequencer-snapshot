UPDATE seq_sequence_runs
SET
  status = 'exited',
  completed_at = COALESCE(completed_at, datetime('now'))
WHERE status = 'running'
  AND product_id IN ('prod_capveri', 'prod_lextract');

UPDATE seq_products
SET
  firewall_partner_id = NULL,
  updated_at = datetime('now')
WHERE firewall_partner_id IN ('prod_capveri', 'prod_lextract');

UPDATE seq_contact_products
SET
  status = 'unsubscribed',
  unsubscribed_at = COALESCE(unsubscribed_at, datetime('now')),
  unsubscribe_scope = COALESCE(unsubscribe_scope, 'product'),
  updated_at = datetime('now')
WHERE status = 'active'
  AND product_id IN ('prod_capveri', 'prod_lextract');

UPDATE seq_list_members
SET
  status = 'unsubscribed',
  unsubscribed_at = COALESCE(unsubscribed_at, datetime('now'))
WHERE status = 'subscribed'
  AND list_id IN (
    SELECT id
    FROM seq_lists
    WHERE product_id IN ('prod_capveri', 'prod_lextract')
  );

UPDATE seq_instantly_suppression_jobs
SET
  status = 'dead',
  last_error = COALESCE(last_error, 'Product retired'),
  next_attempt_at = NULL,
  locked_at = NULL,
  completed_at = COALESCE(completed_at, datetime('now')),
  updated_at = datetime('now')
WHERE status IN ('pending', 'running', 'failed')
  AND product IN ('capveri', 'lextract');

DELETE FROM seq_api_tokens
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_lead_magnets
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_suppressions
WHERE scope = 'product'
  AND product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_contact_sources
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_messages
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_steps
WHERE run_id IN (
  SELECT id
  FROM seq_sequence_runs
  WHERE product_id IN ('prod_capveri', 'prod_lextract')
);

DELETE FROM seq_sequence_runs
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_templates
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_list_members
WHERE list_id IN (
  SELECT id
  FROM seq_lists
  WHERE product_id IN ('prod_capveri', 'prod_lextract')
);

DELETE FROM seq_lists
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_contact_products
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_instantly_campaign_daily_stats
WHERE campaign_id IN (
  SELECT id
  FROM seq_instantly_campaigns
  WHERE product_id IN ('prod_capveri', 'prod_lextract')
);

DELETE FROM seq_instantly_campaigns
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_sequences
WHERE product_id IN ('prod_capveri', 'prod_lextract');

DELETE FROM seq_products
WHERE id IN ('prod_capveri', 'prod_lextract');
