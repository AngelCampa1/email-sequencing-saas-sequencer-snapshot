--> statement-breakpoint
CREATE TRIGGER `seq_sequence_runs_require_product_id_after_update`
BEFORE UPDATE OF `product_id`, `sequence_slug`, `status` ON `seq_sequence_runs`
WHEN NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'product_id is required for sequence run updates');
END;
