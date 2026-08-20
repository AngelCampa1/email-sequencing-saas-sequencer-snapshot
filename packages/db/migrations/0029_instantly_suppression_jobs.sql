CREATE TABLE `seq_instantly_suppression_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_key` text NOT NULL,
	`email` text NOT NULL,
	`product` text NOT NULL,
	`event_type` text NOT NULL,
	`properties` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 8 NOT NULL,
	`last_error` text,
	`result` text,
	`next_attempt_at` text,
	`locked_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_instantly_suppression_jobs_job_key` ON `seq_instantly_suppression_jobs` (`job_key`);--> statement-breakpoint
CREATE INDEX `idx_instantly_suppression_jobs_status_next` ON `seq_instantly_suppression_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_instantly_suppression_jobs_email_product` ON `seq_instantly_suppression_jobs` (`email`,`product`);