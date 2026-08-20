ALTER TABLE `seq_events` ADD `provider_event_id` text;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_provider_message_type_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_provider_event_unique` ON `seq_events` (`provider`,`provider_event_id`) WHERE `provider_event_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_instantly_message_type_unique` ON `seq_events` (`provider`,`message_id`,`type`) WHERE `message_id` IS NOT NULL AND `provider` = 'instantly';
