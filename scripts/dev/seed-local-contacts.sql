-- Local-only dev seed: contacts, enrollments, sent messages, suppressions, audit trail.
-- Safe to re-run. Local D1 only - never run against --remote.
-- Populates every dashboard page with a "has data" state for visual review.
--
-- TIMESTAMP CONTRACT - read before editing.
--
-- All timestamps are RELATIVE, written as strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-N days'),
-- optionally with a trailing '-N hours' modifier to vary the time of day.
-- Two rules make that shape mandatory:
--
--   1. Relative, not absolute. GET /api/internal/overview derives its 7/30/90 day
--      windows from Date.now(). A seed pinned to fixed dates silently rots: every
--      card reads zero and every sequence is flagged stale.
--   2. strftime with the T/Z form, not datetime(). The overview compares timestamps
--      as raw strings, and production writes new Date().toISOString() ("2026-08-07T14:06:00.000Z").
--      datetime() emits a space separator instead of "T"; a space (0x20) sorts below
--      "T" (0x54), so boundary-day rows would fall out of their window regardless of
--      the actual time. Matching the production format keeps the comparison honest.
--
-- Date-only columns (seq_domain_health.date, seq_instantly_campaign_daily_stats.date)
-- use date('now', '-N days') because the application compares them as bare dates.
--
-- Email addresses use RFC 2606 reserved domains (example.com and subdomains of it),
-- which can never resolve to a real organisation. All contact data here is invented.

-- --- Clean prior dev seed (idempotent) --------------------------------------
DELETE FROM seq_instantly_campaign_daily_stats WHERE campaign_id LIKE 'dev_ic_%';
DELETE FROM seq_instantly_campaigns  WHERE id LIKE 'dev_ic_%';
DELETE FROM seq_lead_magnets         WHERE id LIKE 'dev_lm_%';
DELETE FROM seq_domain_health        WHERE id LIKE 'dev_dh_%';
DELETE FROM seq_api_tokens           WHERE id LIKE 'dev_tok_%';
DELETE FROM seq_audit_log            WHERE id LIKE 'dev_audit_%';
DELETE FROM seq_suppressions         WHERE id LIKE 'dev_sup_%';
DELETE FROM seq_messages             WHERE id LIKE 'dev_msg_%' OR id LIKE 'dev_gm_%';
DELETE FROM seq_steps                WHERE id LIKE 'dev_st_%'  OR id LIKE 'dev_gs_%';
DELETE FROM seq_sequence_runs        WHERE id LIKE 'dev_run_%' OR id LIKE 'dev_grun_%';
DELETE FROM seq_contact_products     WHERE id LIKE 'dev_cp_%'  OR id LIKE 'dev_gcp_%';
DELETE FROM seq_contacts             WHERE email LIKE '%@example.com' OR email LIKE '%.example.com';

-- --- Story contacts ---------------------------------------------------------
-- Five named contacts with hand-written subjects, so the Contacts detail sheet
-- and its timeline read like a real account rather than generated filler.
-- Ids are real UUIDs because the contact-detail route validates them strictly.
INSERT OR IGNORE INTO seq_contacts (id, email, first_name, last_name, created_at, updated_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'sarah.chen@meridian-properties.example.com', 'Sarah',  'Chen',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-71 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('22222222-2222-4222-8222-222222222222', 'david.okafor@brightway-realty.example.com',  'David',  'Okafor',  strftime('%Y-%m-%dT%H:%M:%fZ','now','-80 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days')),
  ('33333333-3333-4333-8333-333333333333', 'linda.park@coastal-cre.example.com',         'Linda',  'Park',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-99 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days')),
  ('44444444-4444-4444-8444-444444444444', 'marcus.bell@summit-advisors.example.com',    'Marcus', 'Bell',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-68 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('55555555-5555-4555-8555-555555555555', 'nina.alvarez@greenfield-law.example.com',    'Nina',   'Alvarez', strftime('%Y-%m-%dT%H:%M:%fZ','now','-87 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'));

INSERT OR IGNORE INTO seq_contact_products (id, contact_id, product_id, status, created_at, updated_at, unsubscribed_at, unsubscribe_scope) VALUES
  ('dev_cp_sarah',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 'active',       strftime('%Y-%m-%dT%H:%M:%fZ','now','-71 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),  NULL, NULL),
  ('dev_cp_david',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 'active',       strftime('%Y-%m-%dT%H:%M:%fZ','now','-80 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  NULL, NULL),
  ('dev_cp_linda',  '33333333-3333-4333-8333-333333333333', 'prod_camaudit', 'unsubscribed', strftime('%Y-%m-%dT%H:%M:%fZ','now','-99 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), 'product'),
  ('dev_cp_marcus', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 'active',       strftime('%Y-%m-%dT%H:%M:%fZ','now','-68 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  NULL, NULL),
  ('dev_cp_nina',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 'active',       strftime('%Y-%m-%dT%H:%M:%fZ','now','-87 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  NULL, NULL);

-- Two running, two completed, one exited.
-- The two completed runs finish an hour AFTER their final send ('-1 days','+1 hours').
-- Writing both as plain '-1 days' made completed_at land a few microseconds before the
-- last sent_at, because SQLite re-reads 'now' for each statement and the steps below are
-- inserted after this one.
INSERT OR IGNORE INTO seq_sequence_runs (id, contact_id, product_id, sequence_slug, sequence_version, status, current_step_index, started_at, completed_at, enrollment_source) VALUES
  ('dev_run_sarah',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 'camaudit-white-label-pricing-sheet',             1, 'running',   6, strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), NULL,                                                    'lead_magnet'),
  ('dev_run_david',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 'camaudit-tenant-rep-cam-audit-revenue-playbook', 1, 'completed', 6, strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days','+1 hours'), 'api'),
  ('dev_run_linda',  '33333333-3333-4333-8333-333333333333', 'prod_camaudit', 'camaudit-white-label-pricing-sheet',             1, 'exited',    4, strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), 'lead_magnet'),
  ('dev_run_marcus', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 'camaudit-tenant-rep-cam-audit-revenue-playbook', 1, 'running',   6, strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days'), NULL,                                                    'lead_magnet'),
  ('dev_run_nina',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 'camaudit-white-label-pricing-sheet',             1, 'completed', 6, strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days','+1 hours'), 'api');

INSERT OR IGNORE INTO seq_steps (id, run_id, step_index, scheduled_for, sent_at, message_id, template_slug, status, created_at) VALUES
  ('dev_st_sarah_0',  'dev_run_sarah',  0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), 'dev_msg_sarah_0', 'camaudit-white-label-pricing-sheet-1', 'sent',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days')),
  ('dev_st_sarah_1',  'dev_run_sarah',  1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), 'dev_msg_sarah_1', 'camaudit-white-label-pricing-sheet-2', 'sent',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('dev_st_sarah_2',  'dev_run_sarah',  2, strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days'),  'dev_msg_sarah_2', 'camaudit-white-label-pricing-sheet-3', 'sent',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days')),
  ('dev_st_sarah_3',  'dev_run_sarah',  3, strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  'dev_msg_sarah_3', 'camaudit-white-label-pricing-sheet-4', 'sent',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_st_sarah_4',  'dev_run_sarah',  4, strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  'dev_msg_sarah_4', 'camaudit-white-label-pricing-sheet-5', 'sent',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days')),
  ('dev_st_sarah_5',  'dev_run_sarah',  5, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),  'dev_msg_sarah_5', 'camaudit-white-label-pricing-sheet-6', 'sent',    strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('dev_st_sarah_6',  'dev_run_sarah',  6, strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 days'),  NULL,                                            NULL,              'camaudit-white-label-pricing-sheet-7', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),

  ('dev_st_david_0',  'dev_run_david',  0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), 'dev_msg_david_0', 'camaudit-tenant-rep-cam-audit-revenue-playbook-1', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days')),
  ('dev_st_david_1',  'dev_run_david',  1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-18 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-18 days'), 'dev_msg_david_1', 'camaudit-tenant-rep-cam-audit-revenue-playbook-2', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-18 days')),
  ('dev_st_david_2',  'dev_run_david',  2, strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days'), 'dev_msg_david_2', 'camaudit-tenant-rep-cam-audit-revenue-playbook-3', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')),
  ('dev_st_david_3',  'dev_run_david',  3, strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), 'dev_msg_david_3', 'camaudit-tenant-rep-cam-audit-revenue-playbook-4', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days')),
  ('dev_st_david_4',  'dev_run_david',  4, strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  'dev_msg_david_4', 'camaudit-tenant-rep-cam-audit-revenue-playbook-5', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('dev_st_david_5',  'dev_run_david',  5, strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  'dev_msg_david_5', 'camaudit-tenant-rep-cam-audit-revenue-playbook-6', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days')),

  ('dev_st_linda_0',  'dev_run_linda',  0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'), 'dev_msg_linda_0', 'camaudit-white-label-pricing-sheet-1', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days')),
  ('dev_st_linda_1',  'dev_run_linda',  1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days'), 'dev_msg_linda_1', 'camaudit-white-label-pricing-sheet-2', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days')),
  ('dev_st_linda_2',  'dev_run_linda',  2, strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), 'dev_msg_linda_2', 'camaudit-white-label-pricing-sheet-3', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days')),
  ('dev_st_linda_3',  'dev_run_linda',  3, strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days'), 'dev_msg_linda_3', 'camaudit-white-label-pricing-sheet-4', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days')),

  ('dev_st_marcus_0', 'dev_run_marcus', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days'), 'dev_msg_marcus_0', 'camaudit-tenant-rep-cam-audit-revenue-playbook-1', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days')),
  ('dev_st_marcus_1', 'dev_run_marcus', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), 'dev_msg_marcus_1', 'camaudit-tenant-rep-cam-audit-revenue-playbook-2', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days')),
  ('dev_st_marcus_2', 'dev_run_marcus', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), 'dev_msg_marcus_2', 'camaudit-tenant-rep-cam-audit-revenue-playbook-3', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('dev_st_marcus_3', 'dev_run_marcus', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  'dev_msg_marcus_3', 'camaudit-tenant-rep-cam-audit-revenue-playbook-4', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_st_marcus_4', 'dev_run_marcus', 4, strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  'dev_msg_marcus_4', 'camaudit-tenant-rep-cam-audit-revenue-playbook-5', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('dev_st_marcus_5', 'dev_run_marcus', 5, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  'dev_msg_marcus_5', 'camaudit-tenant-rep-cam-audit-revenue-playbook-6', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('dev_st_marcus_6', 'dev_run_marcus', 6, strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 days'),  NULL,                                            NULL,               'camaudit-tenant-rep-cam-audit-revenue-playbook-7', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),

  ('dev_st_nina_0',   'dev_run_nina',   0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), 'dev_msg_nina_0', 'camaudit-white-label-pricing-sheet-1', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days')),
  ('dev_st_nina_1',   'dev_run_nina',   1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days'), 'dev_msg_nina_1', 'camaudit-white-label-pricing-sheet-2', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days')),
  ('dev_st_nina_2',   'dev_run_nina',   2, strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  'dev_msg_nina_2', 'camaudit-white-label-pricing-sheet-3', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_st_nina_3',   'dev_run_nina',   3, strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  'dev_msg_nina_3', 'camaudit-white-label-pricing-sheet-4', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days')),
  ('dev_st_nina_4',   'dev_run_nina',   4, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  'dev_msg_nina_4', 'camaudit-white-label-pricing-sheet-5', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('dev_st_nina_5',   'dev_run_nina',   5, strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  'dev_msg_nina_5', 'camaudit-white-label-pricing-sheet-6', 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'));

INSERT OR IGNORE INTO seq_messages (id, step_id, contact_id, product_id, resend_message_id, subject, from_email, sent_at, delivered_at, opened_at, first_clicked_at, replied_at, bounced_at, created_at) VALUES
  ('dev_msg_sarah_0',  'dev_st_sarah_0',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 're_dev_sarah_0',  'Your white-label pricing sheet',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days')),
  ('dev_msg_sarah_1',  'dev_st_sarah_1',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 're_dev_sarah_1',  'How partners price CAM audits',               'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('dev_msg_sarah_2',  'dev_st_sarah_2',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 're_dev_sarah_2',  'The three line items tenants miss',           'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days'),  NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days')),
  ('dev_msg_sarah_3',  'dev_st_sarah_3',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 're_dev_sarah_3',  'What a gross-up clause actually allows',      'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_msg_sarah_4',  'dev_st_sarah_4',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 're_dev_sarah_4',  'Reading a reconciliation statement',          'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days')),
  ('dev_msg_sarah_5',  'dev_st_sarah_5',  '11111111-1111-4111-8111-111111111111', 'prod_camaudit', 're_dev_sarah_5',  'Audit windows close faster than you think',   'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),  NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),

  ('dev_msg_david_0',  'dev_st_david_0',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 're_dev_david_0',  'Your revenue playbook is ready',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days')),
  ('dev_msg_david_1',  'dev_st_david_1',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 're_dev_david_1',  'Three ways to grow CAM revenue',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-18 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-18 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-18 days')),
  ('dev_msg_david_2',  'dev_st_david_2',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 're_dev_david_2',  'Scoping an audit engagement',                 'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days'), NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')),
  ('dev_msg_david_3',  'dev_st_david_3',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 're_dev_david_3',  'Pricing a contingency engagement',            'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days')),
  ('dev_msg_david_4',  'dev_st_david_4',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 're_dev_david_4',  'What landlords push back on',                 'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('dev_msg_david_5',  'dev_st_david_5',  '22222222-2222-4222-8222-222222222222', 'prod_camaudit', 're_dev_david_5',  'Ready to talk?',                              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days')),

  ('dev_msg_linda_0',  'dev_st_linda_0',  '33333333-3333-4333-8333-333333333333', 'prod_camaudit', 're_dev_linda_0',  'Your white-label pricing sheet',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days')),
  ('dev_msg_linda_1',  'dev_st_linda_1',  '33333333-3333-4333-8333-333333333333', 'prod_camaudit', 're_dev_linda_1',  'How partners price CAM audits',               'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days'), NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days')),
  ('dev_msg_linda_2',  'dev_st_linda_2',  '33333333-3333-4333-8333-333333333333', 'prod_camaudit', 're_dev_linda_2',  'The three line items tenants miss',           'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days'), NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 days')),
  ('dev_msg_linda_3',  'dev_st_linda_3',  '33333333-3333-4333-8333-333333333333', 'prod_camaudit', 're_dev_linda_3',  'What a gross-up clause actually allows',      'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days'), NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days')),

  ('dev_msg_marcus_0', 'dev_st_marcus_0', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 're_dev_marcus_0', 'Your revenue playbook is ready',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 days')),
  ('dev_msg_marcus_1', 'dev_st_marcus_1', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 're_dev_marcus_1', 'Three ways to grow CAM revenue',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-16 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days')),
  ('dev_msg_marcus_2', 'dev_st_marcus_2', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 're_dev_marcus_2', 'Scoping an audit engagement',                 'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('dev_msg_marcus_3', 'dev_st_marcus_3', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 're_dev_marcus_3', 'Pricing a contingency engagement',            'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_msg_marcus_4', 'dev_st_marcus_4', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 're_dev_marcus_4', 'What landlords push back on',                 'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'),  NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('dev_msg_marcus_5', 'dev_st_marcus_5', '44444444-4444-4444-8444-444444444444', 'prod_camaudit', 're_dev_marcus_5', 'A 20 minute look at your reconciliation',     'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),

  ('dev_msg_nina_0',   'dev_st_nina_0',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 're_dev_nina_0',   'Your white-label pricing sheet',              'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days')),
  ('dev_msg_nina_1',   'dev_st_nina_1',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 're_dev_nina_1',   'How partners price CAM audits',               'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 days')),
  -- One bounce inside the 7 day window so the bounce-rate card is a real number.
  ('dev_msg_nina_2',   'dev_st_nina_2',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 're_dev_nina_2',   'The three line items tenants miss',           'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'),  NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_msg_nina_3',   'dev_st_nina_3',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 're_dev_nina_3',   'What a gross-up clause actually allows',      'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days'),  NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 days')),
  ('dev_msg_nina_4',   'dev_st_nina_4',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 're_dev_nina_4',   'Reading a reconciliation statement',          'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('dev_msg_nina_5',   'dev_st_nina_5',   '55555555-5555-4555-8555-555555555555', 'prod_camaudit', 're_dev_nina_5',   'Audit windows close faster than you think',   'hello@camaudit.io', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'));

-- --- Generated volume -------------------------------------------------------
-- 60 additional contacts, each with one run and three sends. These exist so the
-- Contacts table paginates, the Overview send-volume cards carry a realistic
-- denominator, and the derived rates (unsubscribe, bounce) land in a believable
-- range instead of the double digits a five-contact sample would produce.
--
-- The ids are deterministic UUIDs built with printf, so re-running the seed
-- replaces the same rows rather than accumulating new ones.

INSERT OR IGNORE INTO seq_contacts (id, email, first_name, last_name, created_at, updated_at)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60)
SELECT
  printf('%08x-0000-4000-8000-%012x', i, i),
  printf('contact%02d@example.com', i),
  'Contact',
  printf('%02d', i),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (30 + (i % 60)) || ' days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (i % 7) || ' days')
FROM n;

INSERT OR IGNORE INTO seq_contact_products (id, contact_id, product_id, status, created_at, updated_at, unsubscribed_at, unsubscribe_scope)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60)
SELECT
  printf('dev_gcp_%04d', i),
  printf('%08x-0000-4000-8000-%012x', i, i),
  'prod_camaudit',
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (30 + (i % 60)) || ' days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (i % 7) || ' days'),
  NULL,
  NULL
FROM n;

-- completed_at must stay at or after the run's final send. The last of the three sends
-- below lands (1 + (i % 5)) days ago, so a completed run finishes one day later,
-- at (i % 5) days ago minus two hours - always after the send, never in the future.
INSERT OR IGNORE INTO seq_sequence_runs (id, contact_id, product_id, sequence_slug, sequence_version, status, current_step_index, started_at, completed_at, enrollment_source)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60)
SELECT
  printf('dev_grun_%04d', i),
  printf('%08x-0000-4000-8000-%012x', i, i),
  'prod_camaudit',
  CASE WHEN i % 2 = 0 THEN 'camaudit-white-label-pricing-sheet'
       ELSE 'camaudit-tenant-rep-cam-audit-revenue-playbook' END,
  1,
  CASE WHEN i % 3 = 0 THEN 'running' ELSE 'completed' END,
  3,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (30 + (i % 20)) || ' days'),
  CASE WHEN i % 3 = 0 THEN NULL
       ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (i % 5) || ' days', '-2 hours') END,
  CASE WHEN i % 4 = 0 THEN 'api' ELSE 'lead_magnet' END
FROM n;

-- Three sends per generated contact, oldest first.
--
-- STEP CHRONOLOGY - read before editing.
--
-- A step offset is a number of days AGO, so a later step needs a SMALLER offset.
-- The offsets are built backwards from the final send:
--
--   gap  = 2 + (i % 4)                  -- 2 to 5 days between consecutive sends
--   tail = 1 + (i % 5)                  -- final send is 1 to 5 days ago
--   days_ago(j) = tail + (2 - j) * gap  -- step 0 oldest, step 2 newest
--
-- Because gap is at least 2 days and the time-of-day jitter below spans at most
-- 8 hours, consecutive sends are always at least 40 hours apart. That gives
-- strictly increasing timestamps AND a distinct calendar day per step, so the
-- contact timeline never shows two sends stacked on one date.
--
-- Ranges: step 0 lands 5-15 days ago, step 1 3-10, step 2 1-5. Every send stays
-- inside 30 days, roughly half land inside 7 days, and step 0 always lands after
-- started_at (30-49 days ago).
--
-- hours_ago varies the clock time so the timeline does not read as a batch job.
INSERT OR IGNORE INTO seq_steps (id, run_id, step_index, scheduled_for, sent_at, message_id, template_slug, status, created_at)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60),
     k(j) AS (VALUES (0), (1), (2)),
     g AS (
       SELECT i, j,
              (1 + (i % 5)) + (2 - j) * (2 + (i % 4)) AS days_ago,
              4 + ((i * 3 + j * 7) % 9)               AS hours_ago
       FROM n, k
     )
SELECT
  printf('dev_gs_%04d_%d', i, j),
  printf('dev_grun_%04d', i),
  j,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || hours_ago || ' hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || hours_ago || ' hours'),
  printf('dev_gm_%04d_%d', i, j),
  CASE WHEN i % 2 = 0 THEN printf('camaudit-white-label-pricing-sheet-%d', j + 1)
       ELSE printf('camaudit-tenant-rep-cam-audit-revenue-playbook-%d', j + 1) END,
  'sent',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || hours_ago || ' hours')
FROM g;

-- Same days_ago / hours_ago formula as seq_steps above, so each message matches the
-- send time of its step. Delivery, open and click subtract a little more from the
-- hours offset, which places them after the send on the same day.
INSERT OR IGNORE INTO seq_messages (id, step_id, contact_id, product_id, resend_message_id, subject, from_email, sent_at, delivered_at, opened_at, first_clicked_at, created_at)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60),
     k(j) AS (VALUES (0), (1), (2)),
     g AS (
       SELECT i, j,
              (1 + (i % 5)) + (2 - j) * (2 + (i % 4)) AS days_ago,
              4 + ((i * 3 + j * 7) % 9)               AS hours_ago
       FROM n, k
     )
SELECT
  printf('dev_gm_%04d_%d', i, j),
  printf('dev_gs_%04d_%d', i, j),
  printf('%08x-0000-4000-8000-%012x', i, i),
  'prod_camaudit',
  printf('re_dev_gen_%04d_%d', i, j),
  CASE j WHEN 0 THEN 'Your white-label pricing sheet'
         WHEN 1 THEN 'How partners price CAM audits'
         ELSE 'The three line items tenants miss' END,
  'hello@camaudit.io',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || hours_ago || ' hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || (hours_ago - 1) || ' hours'),
  -- Roughly half opened, a quarter of those clicked.
  CASE WHEN (i + j) % 2 = 0 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || (hours_ago - 3) || ' hours') END,
  CASE WHEN (i + j) % 4 = 0 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || (hours_ago - 4) || ' hours') END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || days_ago || ' days', '-' || hours_ago || ' hours')
FROM g;

-- --- Suppressions -----------------------------------------------------------
-- Both scopes, several sources. Two carry an unsubscribe reason inside the 7 day
-- window, which is what the Overview unsubscribe-rate card counts.
-- Respects the two partial unique indexes: one global row per email, one product
-- row per (email, product_id).
INSERT OR IGNORE INTO seq_suppressions (id, email, scope, product_id, reason, source, created_at) VALUES
  ('dev_sup_1', 'linda.park@coastal-cre.example.com',   'product', 'prod_camaudit', 'unsubscribed',         'webhook',           strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days')),
  ('dev_sup_2', 'contact07@example.com',                'global',  NULL,            'one_click_unsubscribe','webhook',           strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('dev_sup_3', 'contact19@example.com',                'global',  NULL,            'complaint',            'complaint',         strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 days')),
  ('dev_sup_4', 'contact28@example.com',                'product', 'prod_camaudit', 'unsubscribed',         'webhook',           strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('dev_sup_5', 'contact41@example.com',                'global',  NULL,            'hard_bounce',          'bounce',            strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')),
  ('dev_sup_6', 'bad-address@example.com',              'global',  NULL,            'manual review',        'manual',            strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days')),
  ('dev_sup_7', 'contact53@example.com',                'product', 'prod_camaudit', 'cold outreach opt-out','instantly_webhook', strftime('%Y-%m-%dT%H:%M:%fZ','now','-9 days'));

-- --- Audit log --------------------------------------------------------------
-- Every mutating internal endpoint writes one of these with the actor taken from
-- the Cloudflare Access JWT. Seeded with real before/after payloads so the
-- expandable diff on the Audit Log page has something to show.
INSERT OR IGNORE INTO seq_audit_log (id, actor, action, target_type, target_id, before, after, at) VALUES
  ('dev_audit_1', 'operator@example.com', 'sequence.updated',    'sequence',    'camaudit-white-label-pricing-sheet',
    '{"version":1,"active":true}', '{"version":2,"active":true}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days')),
  ('dev_audit_2', 'operator@example.com', 'suppression.created', 'suppression', 'dev_sup_4',
    NULL, '{"email":"contact28@example.com","scope":"product","product_id":"prod_camaudit","reason":"unsubscribed"}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('dev_audit_3', 'operator@example.com', 'product.updated',     'product',     'prod_camaudit',
    '{"brand_color":"#0F766E","reply_to":"hello@camaudit.io"}', '{"brand_color":"#0D9488","reply_to":"hello@camaudit.io"}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('dev_audit_4', 'api:camaudit',         'contact.upserted',    'contact',     '11111111-1111-4111-8111-111111111111',
    '{"first_name":null,"last_name":null}', '{"first_name":"Sarah","last_name":"Chen"}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')),
  ('dev_audit_5', 'operator@example.com', 'lead_magnet.updated', 'lead_magnet', 'dev_lm_cam_pricing',
    '{"asset_r2_key":"camaudit/pricing-sheet-v1.pdf","active":true}', '{"asset_r2_key":"camaudit/white-label-pricing-sheet.pdf","active":true}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('dev_audit_6', 'system',               'suppression.created', 'suppression', 'dev_sup_5',
    NULL, '{"email":"contact41@example.com","scope":"global","reason":"hard_bounce","source":"bounce"}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')),
  ('dev_audit_7', 'operator@example.com', 'contact.deleted',     'contact',     '99999999-9999-4999-8999-999999999999',
    '{"email":"removed@example.com","products":["prod_camaudit"]}', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-17 days')),
  ('dev_audit_8', 'operator@example.com', 'api_token.revoked',   'api_token',   'dev_token_legacy',
    '{"revoked_at":null}', '{"revoked_at":"seeded"}', strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 days'));

-- --- Product API tokens -----------------------------------------------------
-- Maps a Cloudflare Access service-token client id to a product. These are not
-- credentials: the client id is only trusted after Access itself has verified
-- the token, and the Worker rejects any id that does not end in ".access".
-- One revoked row so the Settings table shows both states.
INSERT OR IGNORE INTO seq_api_tokens (id, product_id, label, access_service_token_id, created_at, revoked_at) VALUES
  ('dev_tok_camaudit', 'prod_camaudit',    'camaudit production client', '00000000-0000-4000-8000-000000000001.access', strftime('%Y-%m-%dT%H:%M:%fZ','now','-110 days'), NULL),
  ('dev_tok_floriva',  'prod_floriva_web', 'floriva-web production client', '00000000-0000-4000-8000-000000000002.access', strftime('%Y-%m-%dT%H:%M:%fZ','now','-84 days'), NULL),
  ('dev_tok_legacy',   'prod_camaudit',    'legacy staging client',      '00000000-0000-4000-8000-000000000003.access', strftime('%Y-%m-%dT%H:%M:%fZ','now','-140 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 days'));

-- --- Domain health (warm sending, via Resend) -------------------------------
-- 14 consecutive days so the Deliverability sparkline has a real series to draw.
INSERT OR IGNORE INTO seq_domain_health (id, domain, date, sent, delivered, bounced, complained, opened, clicked, unsubscribed)
WITH RECURSIVE d(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM d WHERE k < 13)
SELECT
  printf('dev_dh_cam_%02d', k),
  'camaudit.io',
  date('now', '-' || k || ' days'),
  380 + ((k * 37) % 90),
  374 + ((k * 37) % 90),
  1 + (k % 4),
  (k % 3) / 2,
  170 + ((k * 23) % 60),
  33 + ((k * 11) % 22),
  (k % 4) / 2
FROM d;

-- --- Instantly campaigns (cold outreach) ------------------------------------
-- One assigned to a product and one left unassigned, so both the assigned Badge
-- and the "Unassigned" state render on the Deliverability page.
INSERT OR IGNORE INTO seq_instantly_campaigns (id, product_id, name, status, created_at_instantly, synced_at) VALUES
  ('dev_ic_cam_q2', 'prod_camaudit', 'CAMAudit - CRE Q2 Outbound',  'active', strftime('%Y-%m-%dT%H:%M:%fZ','now','-115 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hours')),
  ('dev_ic_unassn', NULL,            'CRE Property Managers - Test', 'paused', strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days'),  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hours'));

INSERT OR IGNORE INTO seq_instantly_campaign_daily_stats (id, campaign_id, date, sent, opened, replied, interested, bounced)
WITH RECURSIVE d(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM d WHERE k < 6)
SELECT
  printf('dev_ics_cam_%02d', k),
  'dev_ic_cam_q2',
  date('now', '-' || k || ' days'),
  210 + ((k * 19) % 70),
  105 + ((k * 13) % 40),
  9 + (k % 7),
  3 + (k % 4),
  2 + (k % 3)
FROM d;

-- --- Lead magnets (free downloads) ------------------------------------------
-- A spread of asset/follow-up states so the table exercises every Status badge,
-- Asset badge, and the humanized Follow-up Email column:
--   - one fully wired (file linked + follow-up sequence), active
--   - one active with a follow-up but no file yet (asset reads "No file yet")
--   - one inactive with no follow-up at all ("No follow-up email")
INSERT OR IGNORE INTO seq_lead_magnets
  (id, product_id, slug, name, asset_r2_bucket, asset_r2_key, fulfillment_sequence_slug, active, created_at) VALUES
  ('dev_lm_cam_pricing',  'prod_camaudit', 'camaudit-white-label-pricing-sheet', 'White-Label Pricing Sheet',
    'sequencer-assets', 'camaudit/white-label-pricing-sheet.pdf', 'camaudit-white-label-pricing-sheet', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-120 days')),
  ('dev_lm_cam_playbook', 'prod_camaudit', 'camaudit-tenant-rep-cam-audit-revenue-playbook', 'Tenant-Rep CAM Audit Revenue Playbook',
    NULL, NULL, 'camaudit-tenant-rep-cam-audit-revenue-playbook', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-95 days')),
  ('dev_lm_cam_retired',  'prod_camaudit', 'camaudit-lease-clause-glossary', 'Lease Clause Glossary',
    'sequencer-assets', 'camaudit/lease-clause-glossary.pdf', NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-150 days'));
