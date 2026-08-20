ALTER TABLE `seq_contact_products` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `seq_contact_products` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `seq_contact_products` ADD `properties` text;--> statement-breakpoint
UPDATE `seq_contact_products`
SET
  `first_name` = (
    SELECT `first_name`
    FROM `seq_contacts`
    WHERE `seq_contacts`.`id` = `seq_contact_products`.`contact_id`
  ),
  `last_name` = (
    SELECT `last_name`
    FROM `seq_contacts`
    WHERE `seq_contacts`.`id` = `seq_contact_products`.`contact_id`
  ),
  `properties` = (
    SELECT `properties`
    FROM `seq_contacts`
    WHERE `seq_contacts`.`id` = `seq_contact_products`.`contact_id`
  )
WHERE (
  SELECT COUNT(*)
  FROM `seq_contact_products` AS `contact_product_count`
  WHERE `contact_product_count`.`contact_id` = `seq_contact_products`.`contact_id`
) = 1;
