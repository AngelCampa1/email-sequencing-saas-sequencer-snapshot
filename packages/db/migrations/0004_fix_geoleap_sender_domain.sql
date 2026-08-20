UPDATE seq_products
SET default_from_email = 'hello@geoleap.app',
    updated_at = datetime('now')
WHERE slug = 'geoleap'
  AND default_from_email = 'hello@mail.geoleap.app';
