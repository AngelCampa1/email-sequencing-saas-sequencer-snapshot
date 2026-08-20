ALTER TABLE `seq_messages` ADD `suppressed_at` text;
--> statement-breakpoint
ALTER TABLE `seq_messages` ADD `failed_at` text;
--> statement-breakpoint
ALTER TABLE `seq_messages` ADD `failure_reason` text;
