-- Additive repeated-list configuration. Rollback: disable repeated-list configuration and preview behavior,
-- then restore a verified pre-migration backup if these columns must be removed. Do not drop live columns
-- without a separately reviewed expand/migrate/contract release.
ALTER TABLE `monitor_targets` ADD `item_selector` varchar(512);--> statement-breakpoint
ALTER TABLE `monitor_targets` ADD `identity_selector` varchar(512);--> statement-breakpoint
ALTER TABLE `monitor_targets` ADD `ignore_selectors` json;
