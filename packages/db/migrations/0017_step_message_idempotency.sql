DELETE FROM seq_messages
WHERE step_id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY run_id, step_index
        ORDER BY
          CASE status WHEN 'sent' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
          datetime(created_at) DESC,
          id DESC
      ) AS rn
    FROM seq_steps
  )
  WHERE rn > 1
);
--> statement-breakpoint
DELETE FROM seq_steps
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY run_id, step_index
        ORDER BY
          CASE status WHEN 'sent' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
          datetime(created_at) DESC,
          id DESC
      ) AS rn
    FROM seq_steps
  )
  WHERE rn > 1
);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_steps_run`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_steps_run_step_unique` ON `seq_steps` (`run_id`,`step_index`);
--> statement-breakpoint
DELETE FROM seq_messages
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY step_id
        ORDER BY
          datetime(sent_at) DESC,
          datetime(created_at) DESC,
          id DESC
      ) AS rn
    FROM seq_messages
  )
  WHERE rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_step_unique` ON `seq_messages` (`step_id`);
