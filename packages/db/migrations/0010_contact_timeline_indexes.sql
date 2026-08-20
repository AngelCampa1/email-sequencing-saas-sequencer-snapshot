CREATE INDEX `idx_steps_run` ON `seq_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `idx_events_provider_message` ON `seq_events` (`provider`,`message_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_events_internal_payload` ON `seq_events` (`provider`,json_extract(`payload`, '$.email'),json_extract(`payload`, '$.product'),`received_at`);--> statement-breakpoint
