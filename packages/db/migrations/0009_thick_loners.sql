-- Member-selectable monitor extraction targets. Rollback: disable target configuration and preview routes,
-- then restore a verified pre-migration backup if this table must be removed. Do not drop it from a live
-- production database without a separately reviewed expand/migrate/contract release.
CREATE TABLE `monitor_targets` (
	`monitor_id` varchar(36) NOT NULL,
	`target_type` enum('whole_page','css_selector') NOT NULL DEFAULT 'whole_page',
	`selector` varchar(512),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_targets_monitor_id` PRIMARY KEY(`monitor_id`)
);
--> statement-breakpoint
ALTER TABLE `monitor_targets` ADD CONSTRAINT `monitor_targets_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;
