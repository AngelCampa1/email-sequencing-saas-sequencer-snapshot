UPDATE seq_products
SET default_from_email = 'hello@gathergrove.club',
    updated_at = datetime('now')
WHERE slug = 'gathergrove'
  AND default_from_email = 'hello@mail.gathergrove.club';

UPDATE seq_products
SET default_from_email = 'hello@skillledger.app',
    updated_at = datetime('now')
WHERE slug = 'skillledger'
  AND default_from_email = 'hello@mail.skillledger.app';
