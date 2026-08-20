DELETE FROM `seq_events`
WHERE rowid IN (
  SELECT rowid
  FROM (
    SELECT
      rowid,
      ROW_NUMBER() OVER (
        PARTITION BY `provider`, `message_id`, `type`
        ORDER BY datetime(`received_at`) ASC, rowid ASC
      ) AS rn
    FROM `seq_events`
    WHERE `message_id` IS NOT NULL
      AND `provider` IN ('resend', 'instantly')
  )
  WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_provider_message_type_unique` ON `seq_events` (`provider`,`message_id`,`type`) WHERE `message_id` IS NOT NULL AND `provider` IN ('resend', 'instantly');--> statement-breakpoint
