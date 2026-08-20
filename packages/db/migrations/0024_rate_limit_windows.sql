CREATE TABLE `seq_rate_limit_windows` (
  `key` text PRIMARY KEY NOT NULL,
  `client_id` text NOT NULL,
  `endpoint` text NOT NULL,
  `window_start_ms` integer NOT NULL,
  `window_end_ms` integer NOT NULL,
  `count` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limit_windows_expires` ON `seq_rate_limit_windows` (`window_end_ms`);
