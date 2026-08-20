UPDATE seq_sequence_runs
SET
  status = 'exited',
  completed_at = COALESCE(completed_at, datetime('now'))
WHERE status = 'running'
  AND product_id IN (
    'prod_gathergrove',
    'prod_geoleap',
    'prod_skillledger',
    'prod_kaiplan',
    'prod_pebbledesk',
    'prod_boardstack',
    'prod_phiguard'
  );

UPDATE seq_contact_products
SET
  status = 'unsubscribed',
  unsubscribed_at = COALESCE(unsubscribed_at, datetime('now')),
  unsubscribe_scope = COALESCE(unsubscribe_scope, 'product'),
  updated_at = datetime('now')
WHERE status = 'active'
  AND product_id IN (
    'prod_gathergrove',
    'prod_geoleap',
    'prod_skillledger',
    'prod_kaiplan',
    'prod_pebbledesk',
    'prod_boardstack',
    'prod_phiguard'
  );

UPDATE seq_list_members
SET
  status = 'unsubscribed',
  unsubscribed_at = COALESCE(unsubscribed_at, datetime('now'))
WHERE status = 'subscribed'
  AND list_id IN (
    SELECT id
    FROM seq_lists
    WHERE product_id IN (
      'prod_gathergrove',
      'prod_geoleap',
      'prod_skillledger',
      'prod_kaiplan',
      'prod_pebbledesk',
      'prod_boardstack',
      'prod_phiguard'
    )
  );

UPDATE seq_instantly_campaigns
SET status = 'retired'
WHERE product_id IN (
  'prod_gathergrove',
  'prod_geoleap',
  'prod_skillledger',
  'prod_kaiplan',
  'prod_pebbledesk',
  'prod_boardstack',
  'prod_phiguard'
);

--> statement-breakpoint
CREATE TRIGGER seq_instantly_campaigns_keep_shutdown_products_retired
AFTER UPDATE OF status ON seq_instantly_campaigns
WHEN NEW.status <> 'retired'
  AND NEW.product_id IN (
    'prod_gathergrove',
    'prod_geoleap',
    'prod_skillledger',
    'prod_kaiplan',
    'prod_pebbledesk',
    'prod_boardstack',
    'prod_phiguard'
  )
BEGIN
  UPDATE seq_instantly_campaigns
  SET status = 'retired'
  WHERE id = NEW.id;
END;

--> statement-breakpoint
UPDATE seq_instantly_suppression_jobs
SET
  status = 'dead',
  last_error = COALESCE(last_error, 'Product retired'),
  next_attempt_at = NULL,
  locked_at = NULL,
  completed_at = COALESCE(completed_at, datetime('now')),
  updated_at = datetime('now')
WHERE status IN ('pending', 'running', 'failed')
  AND product IN (
    'gathergrove',
    'geoleap',
    'skillledger',
    'kaiplan',
    'pebbledesk',
    'boardstack',
    'phiguard'
  );

DELETE FROM seq_api_tokens
WHERE product_id IN (
  'prod_gathergrove',
  'prod_geoleap',
  'prod_skillledger',
  'prod_kaiplan',
  'prod_pebbledesk',
  'prod_boardstack',
  'prod_phiguard'
);

DELETE FROM seq_lead_magnets
WHERE product_id IN (
  'prod_gathergrove',
  'prod_geoleap',
  'prod_skillledger',
  'prod_kaiplan',
  'prod_pebbledesk',
  'prod_boardstack',
  'prod_phiguard'
);

DELETE FROM seq_suppressions
WHERE scope = 'product'
  AND product_id IN (
    'prod_gathergrove',
    'prod_geoleap',
    'prod_skillledger',
    'prod_kaiplan',
    'prod_pebbledesk',
    'prod_boardstack',
    'prod_phiguard'
  );

DELETE FROM seq_lists
WHERE product_id IN (
  'prod_gathergrove',
  'prod_geoleap',
  'prod_skillledger',
  'prod_kaiplan',
  'prod_pebbledesk',
  'prod_boardstack',
  'prod_phiguard'
);

DELETE FROM seq_sequences
WHERE product_id IN (
  'prod_gathergrove',
  'prod_geoleap',
  'prod_skillledger',
  'prod_kaiplan',
  'prod_pebbledesk',
  'prod_boardstack',
  'prod_phiguard'
);

DELETE FROM seq_products
WHERE id IN (
  'prod_gathergrove',
  'prod_geoleap',
  'prod_skillledger',
  'prod_kaiplan',
  'prod_pebbledesk',
  'prod_boardstack',
  'prod_phiguard'
);
