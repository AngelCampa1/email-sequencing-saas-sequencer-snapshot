CREATE TABLE `seq_api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`label` text NOT NULL,
	`access_service_token_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seq_api_tokens_access_service_token_id_unique` ON `seq_api_tokens` (`access_service_token_id`);--> statement-breakpoint
CREATE TABLE `seq_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`before` text,
	`after` text,
	`at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `seq_audit_log` (`actor`);--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `seq_audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_at` ON `seq_audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `seq_contact_products` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`product_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`unsubscribed_at` text,
	`unsubscribe_scope` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `seq_contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seq_contact_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lead_magnet_id` text,
	`captured_at` text DEFAULT (datetime('now')) NOT NULL,
	`utm` text,
	FOREIGN KEY (`contact_id`) REFERENCES `seq_contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seq_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`properties` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seq_contacts_email_unique` ON `seq_contacts` (`email`);--> statement-breakpoint
CREATE TABLE `seq_domain_health` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`date` text NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`unsubscribed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_domain_health_domain_date` ON `seq_domain_health` (`domain`,`date`);--> statement-breakpoint
CREATE TABLE `seq_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`message_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_message_id` ON `seq_events` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `seq_events` (`type`,`received_at`);--> statement-breakpoint
CREATE TABLE `seq_instantly_campaign_daily_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`date` text NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`replied` integer DEFAULT 0 NOT NULL,
	`interested` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`synced_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_instantly_stats_campaign_date` ON `seq_instantly_campaign_daily_stats` (`campaign_id`,`date`);--> statement-breakpoint
CREATE TABLE `seq_instantly_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at_instantly` text,
	`synced_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seq_lead_magnets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`asset_r2_key` text,
	`fulfillment_sequence_slug` text,
	`conversion_event_name` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seq_lead_magnets_slug_unique` ON `seq_lead_magnets` (`slug`);--> statement-breakpoint
CREATE TABLE `seq_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`product_id` text NOT NULL,
	`resend_message_id` text,
	`subject` text NOT NULL,
	`from_email` text NOT NULL,
	`html_r2_key` text,
	`sent_at` text,
	`opened_at` text,
	`first_clicked_at` text,
	`replied_at` text,
	`bounced_at` text,
	`complained_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_contact` ON `seq_messages` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_resend_id` ON `seq_messages` (`resend_message_id`);--> statement-breakpoint
CREATE TABLE `seq_products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`brand_color` text DEFAULT '#000000' NOT NULL,
	`default_from_email` text NOT NULL,
	`default_reply_to` text,
	`resend_api_key_secret_name` text NOT NULL,
	`suppression_scope` text DEFAULT 'product' NOT NULL,
	`firewall_partner_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seq_products_slug_unique` ON `seq_products` (`slug`);--> statement-breakpoint
CREATE TABLE `seq_sequence_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`sequence_slug` text NOT NULL,
	`sequence_version` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`current_step_index` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`variant_assignment` text,
	`enrollment_source` text DEFAULT 'api' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runs_contact` ON `seq_sequence_runs` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_sequence` ON `seq_sequence_runs` (`sequence_slug`,`status`);--> statement-breakpoint
CREATE TABLE `seq_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`scheduled_for` text NOT NULL,
	`sent_at` text,
	`message_id` text,
	`template_slug` text NOT NULL,
	`variant` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seq_sequences` (
	`slug` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`goal` text,
	`exit_conditions` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`compiled_at` text DEFAULT (datetime('now')) NOT NULL,
	`compiled_from_sha` text
);
--> statement-breakpoint
CREATE TABLE `seq_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`scope` text NOT NULL,
	`product_id` text,
	`reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_suppressions_email` ON `seq_suppressions` (`email`);--> statement-breakpoint
CREATE INDEX `idx_suppressions_email_scope` ON `seq_suppressions` (`email`,`scope`);--> statement-breakpoint
CREATE TABLE `seq_templates` (
	`slug` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`react_email_path` text NOT NULL,
	`subject_template` text NOT NULL,
	`last_compiled_at` text DEFAULT (datetime('now')) NOT NULL
);
