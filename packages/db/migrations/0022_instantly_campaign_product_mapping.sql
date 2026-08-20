ALTER TABLE `seq_instantly_campaigns` ADD `product_id` text;--> statement-breakpoint
CREATE INDEX `idx_instantly_campaigns_product` ON `seq_instantly_campaigns` (`product_id`);