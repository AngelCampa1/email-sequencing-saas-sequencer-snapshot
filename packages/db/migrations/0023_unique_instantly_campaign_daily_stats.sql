DELETE FROM seq_instantly_campaign_daily_stats
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY campaign_id, date
        ORDER BY datetime(synced_at) DESC, id DESC
      ) AS rn
    FROM seq_instantly_campaign_daily_stats
  )
  WHERE rn > 1
);
--> statement-breakpoint
DROP INDEX `idx_instantly_stats_campaign_date`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_instantly_stats_campaign_date` ON `seq_instantly_campaign_daily_stats` (`campaign_id`,`date`);
