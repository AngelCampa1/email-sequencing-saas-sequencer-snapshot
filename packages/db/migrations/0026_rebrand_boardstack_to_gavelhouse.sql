-- Rebrand the boardstack product to Gavelhouse (recipient-visible identity only).
-- The product app still identifies as slug `boardstack`; only the display name,
-- from-address, and brand color that recipients see change.
UPDATE seq_products
SET name = 'Gavelhouse',
    default_from_email = 'hello@gavelhouse.app',
    brand_color = '#163a5f',
    updated_at = datetime('now')
WHERE id = 'prod_boardstack';
