ALTER TABLE `seq_lead_magnets` ADD `asset_r2_bucket` text;--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'capveri-lead-magnets',
    `asset_r2_key` = 'lead-magnets/cam-pre-send-packet-checklist.pdf'
WHERE `slug` = 'cam-pre-send-packet-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'capveri-lead-magnets',
    `asset_r2_key` = 'lead-magnets/cam-reconciliation-checklist.pdf'
WHERE `slug` = 'capveri-cam-reconciliation-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'lextract-lead-magnets',
    `asset_r2_key` = 'lease-abstraction-checklist-v3.pdf'
WHERE `slug` = 'lease-abstraction-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'floriva-lead-magnets',
    `asset_r2_key` = 'lead-magnets/period-app-privacy-audit-checklist.pdf'
WHERE `slug` = 'period-app-privacy-audit-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'grantpipe-documents',
    `asset_r2_key` = 'lead-magnets/grant-compliance-checklist.pdf'
WHERE `slug` = 'grant-compliance-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'pebbledesk-lead-magnets',
    `asset_r2_key` = 'lead-magnets/licensing-compliance-checklist.pdf'
WHERE `slug` = 'licensing-compliance-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'boardstack-lead-magnets',
    `asset_r2_key` = 'reserve-compliance-checklist.pdf'
WHERE `slug` = 'reserve-compliance-checklist';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'phiguard-lead-magnets',
    `asset_r2_key` = 'lead-magnets/hipaa-compliance-self-assessment.pdf'
WHERE `slug` = 'hipaa-compliance-self-assessment';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_bucket` = 'kaiplan-lead-magnets',
    `asset_r2_key` = 'budget-template.pdf'
WHERE `slug` = 'budget-template';--> statement-breakpoint
UPDATE `seq_lead_magnets`
SET `asset_r2_key` = NULL
WHERE `asset_r2_bucket` IS NULL;
