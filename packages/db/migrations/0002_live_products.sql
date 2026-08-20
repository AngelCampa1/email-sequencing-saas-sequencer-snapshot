UPDATE seq_sequences
SET is_active = 0
WHERE product_id IN ('prod_reachally', 'prod_a11yproof');
--> statement-breakpoint
DELETE FROM seq_products
WHERE id IN ('prod_reachally', 'prod_a11yproof');
--> statement-breakpoint
INSERT INTO seq_products (
  id, slug, name, default_from_email, resend_api_key_secret_name, suppression_scope
) VALUES
  ('prod_floriva_web', 'floriva-web', 'Floriva', 'support@floriva.app', 'RESEND_API_KEY_FLORIVA_WEB', 'product'),
  ('prod_grantpipe', 'grantpipe', 'GrantPipe', 'hello@grantpipe.com', 'RESEND_API_KEY_GRANTPIPE', 'product'),
  ('prod_pebbledesk', 'pebbledesk', 'PebbleDesk', 'hello@pebbledesk.app', 'RESEND_API_KEY_PEBBLEDESK', 'product'),
  ('prod_boardstack', 'boardstack', 'Gavelhouse', 'hello@gavelhouse.app', 'RESEND_API_KEY_BOARDSTACK', 'product'),
  ('prod_phiguard', 'phiguard', 'PHIGuard', 'founder@phiguard.app', 'RESEND_API_KEY_PHIGUARD', 'product'),
  ('prod_kaiplan', 'kaiplan', 'Kaiplan', 'hello@kaiplan.app', 'RESEND_API_KEY_KAIPLAN', 'product')
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  name = excluded.name,
  default_from_email = excluded.default_from_email,
  resend_api_key_secret_name = excluded.resend_api_key_secret_name,
  suppression_scope = excluded.suppression_scope,
  updated_at = datetime('now');
