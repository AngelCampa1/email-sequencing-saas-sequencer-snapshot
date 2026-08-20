ALTER TABLE `seq_sequence_runs` ADD `product_id` text;
--> statement-breakpoint
UPDATE `seq_sequence_runs`
SET `product_id` = COALESCE((
  SELECT `seq_sequences`.`product_id`
  FROM `seq_sequences`
  WHERE `seq_sequences`.`slug` = `seq_sequence_runs`.`sequence_slug`
  LIMIT 1
), 'orphaned-sequence')
WHERE `product_id` IS NULL;
--> statement-breakpoint
UPDATE `seq_sequence_runs`
SET
  `status` = 'errored',
  `completed_at` = COALESCE(`completed_at`, datetime('now'))
WHERE `product_id` = 'orphaned-sequence'
  AND `status` = 'running';
--> statement-breakpoint
WITH ranked_running_runs AS (
  SELECT
    `id`,
    row_number() OVER (
      PARTITION BY `contact_id`, `product_id`
      ORDER BY datetime(`started_at`) ASC, `id` ASC
    ) AS rn
  FROM `seq_sequence_runs`
  WHERE `status` = 'running'
)
UPDATE `seq_sequence_runs`
SET
  `status` = 'exited',
  `completed_at` = COALESCE(`completed_at`, datetime('now'))
WHERE `id` IN (
  SELECT `id`
  FROM ranked_running_runs
  WHERE rn > 1
);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_runs_one_running_per_contact`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_runs_one_running_per_contact_product`
ON `seq_sequence_runs` (`contact_id`, `product_id`)
WHERE `status` = 'running' AND `product_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_runs_one_running_legacy_null_product`
ON `seq_sequence_runs` (`contact_id`)
WHERE `status` = 'running' AND `product_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `seq_sequence_runs_backfill_product_id_after_insert`
AFTER INSERT ON `seq_sequence_runs`
WHEN NEW.`product_id` IS NULL
BEGIN
  UPDATE `seq_sequence_runs`
  SET `product_id` = COALESCE((
    SELECT `seq_sequences`.`product_id`
    FROM `seq_sequences`
    WHERE `seq_sequences`.`slug` = NEW.`sequence_slug`
    LIMIT 1
  ), 'orphaned-sequence')
  WHERE `id` = NEW.`id`;

  UPDATE `seq_sequence_runs`
  SET
    `status` = 'errored',
    `completed_at` = COALESCE(`completed_at`, datetime('now'))
  WHERE `id` = NEW.`id`
    AND `product_id` = 'orphaned-sequence'
    AND `status` = 'running';
END;
