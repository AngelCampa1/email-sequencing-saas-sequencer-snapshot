DELETE FROM `seq_suppressions`
WHERE `scope` = 'product'
  AND `product_id` IS NULL;
DELETE FROM `seq_suppressions`
WHERE `scope` = 'global'
  AND rowid IN (
    SELECT rowid
    FROM (
      SELECT
        rowid,
        ROW_NUMBER() OVER (
          PARTITION BY `email`
          ORDER BY datetime(`created_at`) ASC, rowid ASC
        ) AS duplicate_rank
      FROM `seq_suppressions`
      WHERE `scope` = 'global'
    )
    WHERE duplicate_rank > 1
  );
DELETE FROM `seq_suppressions`
WHERE `scope` = 'product'
  AND `product_id` IS NOT NULL
  AND rowid IN (
    SELECT rowid
    FROM (
      SELECT
        rowid,
        ROW_NUMBER() OVER (
          PARTITION BY `email`, `product_id`
          ORDER BY datetime(`created_at`) ASC, rowid ASC
        ) AS duplicate_rank
      FROM `seq_suppressions`
      WHERE `scope` = 'product'
        AND `product_id` IS NOT NULL
    )
    WHERE duplicate_rank > 1
  );
CREATE UNIQUE INDEX `idx_suppressions_global_unique` ON `seq_suppressions` (`email`) WHERE "seq_suppressions"."scope" = 'global';
CREATE UNIQUE INDEX `idx_suppressions_product_unique` ON `seq_suppressions` (`email`,`product_id`) WHERE "seq_suppressions"."scope" = 'product' AND "seq_suppressions"."product_id" IS NOT NULL;
CREATE TRIGGER `seq_suppressions_product_requires_product_id_insert`
BEFORE INSERT ON `seq_suppressions`
WHEN NEW.`scope` = 'product' AND NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'product_id is required for product suppressions');
END;
CREATE TRIGGER `seq_suppressions_product_requires_product_id_update`
BEFORE UPDATE ON `seq_suppressions`
WHEN NEW.`scope` = 'product' AND NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'product_id is required for product suppressions');
END;
