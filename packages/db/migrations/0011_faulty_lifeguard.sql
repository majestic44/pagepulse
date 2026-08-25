-- Additive monitor rule configuration and baseline state. Rollback: disable rule configuration, then restore a
-- verified pre-migration backup if the table must be removed. Do not drop this live table without a separately
-- reviewed expand/migrate/contract release.
CREATE TABLE `monitor_rules` (
	`monitor_id` varchar(36) NOT NULL,
	`monitor_revision` int NOT NULL,
	`configuration` json NOT NULL,
	`baseline_state` enum('pending','established') NOT NULL DEFAULT 'pending',
	`baseline_revision` int NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_rules_monitor_id` PRIMARY KEY(`monitor_id`)
);
--> statement-breakpoint
ALTER TABLE `monitor_rules` ADD CONSTRAINT `monitor_rules_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;
