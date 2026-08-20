-- Normalize all product default_from_email addresses to founder@<brand-domain>.
-- This corrects any already-migrated database that still holds a hello@/support@/noreply@
-- or other generic sender address from earlier migrations.
UPDATE seq_products SET default_from_email = 'founder@camaudit.io',           updated_at = datetime('now') WHERE slug = 'camaudit';
UPDATE seq_products SET default_from_email = 'founder@capveri.com',           updated_at = datetime('now') WHERE slug = 'capveri';
UPDATE seq_products SET default_from_email = 'founder@lextract.io',           updated_at = datetime('now') WHERE slug = 'lextract';
UPDATE seq_products SET default_from_email = 'founder@geoleap.app',           updated_at = datetime('now') WHERE slug = 'geoleap';
UPDATE seq_products SET default_from_email = 'founder@gathergrove.club',      updated_at = datetime('now') WHERE slug = 'gathergrove';
UPDATE seq_products SET default_from_email = 'founder@skillledger.app',       updated_at = datetime('now') WHERE slug = 'skillledger';
UPDATE seq_products SET default_from_email = 'founder@floriva.app',           updated_at = datetime('now') WHERE slug = 'floriva-web';
UPDATE seq_products SET default_from_email = 'founder@grantpipe.com',         updated_at = datetime('now') WHERE slug = 'grantpipe';
UPDATE seq_products SET default_from_email = 'founder@pebbledesk.app',        updated_at = datetime('now') WHERE slug = 'pebbledesk';
UPDATE seq_products SET default_from_email = 'founder@gavelhouse.app',        updated_at = datetime('now') WHERE slug = 'boardstack';
UPDATE seq_products SET default_from_email = 'founder@phiguard.app',          updated_at = datetime('now') WHERE slug = 'phiguard';
UPDATE seq_products SET default_from_email = 'founder@kaiplan.app',           updated_at = datetime('now') WHERE slug = 'kaiplan';
