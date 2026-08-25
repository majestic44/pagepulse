CREATE TABLE `changes` (
	`id` varchar(36) NOT NULL,
	`monitor_id` varchar(36) NOT NULL,
	`previous_snapshot_id` varchar(36) NOT NULL,
	`current_snapshot_id` varchar(36) NOT NULL,
	`summary` varchar(160) NOT NULL,
	`state` enum('pending','expected','ignored') NOT NULL DEFAULT 'pending',
	`reviewed_at` timestamp,
	`created_at` timestamp NOT NULL,
	CONSTRAINT `changes_id` PRIMARY KEY(`id`),
	CONSTRAINT `changes_current_snapshot_id_unique` UNIQUE(`current_snapshot_id`)
);
--> statement-breakpoint
ALTER TABLE `changes` ADD CONSTRAINT `changes_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `changes` ADD CONSTRAINT `changes_previous_snapshot_id_snapshots_id_fk` FOREIGN KEY (`previous_snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `changes` ADD CONSTRAINT `changes_current_snapshot_id_snapshots_id_fk` FOREIGN KEY (`current_snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `changes_monitor_state_created_idx` ON `changes` (`monitor_id`,`state`,`created_at`);