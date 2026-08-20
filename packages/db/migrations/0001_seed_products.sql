-- Seed Ventora products from product index
INSERT INTO seq_products (id, slug, name, brand_color, default_from_email, resend_api_key_secret_name, suppression_scope) VALUES
  ('prod_camaudit',    'camaudit',    'CAMAudit',    '#1e40af', 'hello@camaudit.io',                'RESEND_API_KEY_CAMAUDIT',    'product'),
  ('prod_capveri',     'capveri',     'CapVeri',     '#0f766e', 'hello@capveri.com',                'RESEND_API_KEY_CAPVERI',     'product'),
  ('prod_lextract',    'lextract',    'Lextract',    '#7c3aed', 'hello@lextract.io',                'RESEND_API_KEY_LEXTRACT',    'product'),
  ('prod_geoleap',     'geoleap',     'GeoLeap',     '#059669', 'hello@mail.geoleap.app',           'RESEND_API_KEY_GEOLEAP',     'product'),
  ('prod_gathergrove', 'gathergrove', 'GatherGrove', '#16a34a', 'hello@mail.gathergrove.club',      'RESEND_API_KEY_GATHERGROVE', 'product'),
  ('prod_skillledger', 'skillledger', 'SkillLedger', '#d97706', 'hello@mail.skillledger.app',       'RESEND_API_KEY_SKILLLEDGER', 'product'),
  ('prod_floriva_web', 'floriva-web', 'Floriva',     '#15803d', 'support@floriva.app',              'RESEND_API_KEY_FLORIVA_WEB', 'product'),
  ('prod_grantpipe',   'grantpipe',   'GrantPipe',   '#2563eb', 'hello@grantpipe.com',              'RESEND_API_KEY_GRANTPIPE',   'product'),
  ('prod_pebbledesk',  'pebbledesk',  'PebbleDesk',  '#0f766e', 'hello@pebbledesk.app',             'RESEND_API_KEY_PEBBLEDESK',  'product'),
  ('prod_boardstack',  'boardstack',  'Gavelhouse',  '#163a5f', 'hello@gavelhouse.app',             'RESEND_API_KEY_BOARDSTACK',  'product'),
  ('prod_phiguard',    'phiguard',    'PHIGuard',    '#7c3aed', 'founder@phiguard.app',         'RESEND_API_KEY_PHIGUARD',    'product'),
  ('prod_kaiplan',     'kaiplan',     'Kaiplan',     '#db2777', 'hello@kaiplan.app',                'RESEND_API_KEY_KAIPLAN',     'product');

-- Set CapVeri<->CAMAudit firewall
UPDATE seq_products SET firewall_partner_id = 'prod_capveri' WHERE id = 'prod_camaudit';
UPDATE seq_products SET firewall_partner_id = 'prod_camaudit' WHERE id = 'prod_capveri';
