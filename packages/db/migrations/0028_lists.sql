CREATE TABLE `seq_lists` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lists_product_slug` ON `seq_lists` (`product_id`,`slug`);
--> statement-breakpoint
CREATE TABLE `seq_list_members` (
  `id` text PRIMARY KEY NOT NULL,
  `list_id` text NOT NULL REFERENCES seq_lists(`id`) ON DELETE CASCADE,
  `contact_id` text NOT NULL REFERENCES seq_contacts(`id`) ON DELETE CASCADE,
  `status` text NOT NULL DEFAULT 'subscribed',
  `source` text,
  `added_at` text NOT NULL DEFAULT (datetime('now')),
  `unsubscribed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_list_members_list_contact` ON `seq_list_members` (`list_id`,`contact_id`);
