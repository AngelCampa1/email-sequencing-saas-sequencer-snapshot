DELETE FROM `seq_contact_products`
WHERE rowid IN (
  SELECT rowid
  FROM (
    SELECT
      rowid,
      CASE `status`
        WHEN 'active' THEN 1
        WHEN 'complained' THEN 2
        WHEN 'bounced' THEN 3
        WHEN 'unsubscribed' THEN 4
        ELSE 5
      END AS status_rank,
      ROW_NUMBER() OVER (
        PARTITION BY `contact_id`, `product_id`
        ORDER BY
          CASE `status`
            WHEN 'active' THEN 1
            WHEN 'complained' THEN 2
            WHEN 'bounced' THEN 3
            WHEN 'unsubscribed' THEN 4
            ELSE 5
          END,
          CASE WHEN `unsubscribed_at` IS NULL THEN 1 ELSE 0 END,
          datetime(`updated_at`) DESC,
          datetime(`created_at`) ASC,
          rowid ASC
      ) AS rn
    FROM `seq_contact_products`
  )
  WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_products_contact_product_unique` ON `seq_contact_products` (`contact_id`,`product_id`);
