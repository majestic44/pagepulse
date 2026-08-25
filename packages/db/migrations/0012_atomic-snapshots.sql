-- Additive snapshot and check-outcome records. Rollback: disable snapshot publication and retention cleanup, then
-- restore a verified pre-migration backup if these tables must be removed. Do not drop live monitoring history
-- without a separately reviewed expand/migrate/contract release.
CREATE TABLE `checks` (
	`id` varchar(36) NOT NULL,
	`monitor_id` varchar(36) NOT NULL,
	`monitor_revision` int NOT NULL,
	`correlation_id` varchar(128) NOT NULL,
	`result` enum('succeeded','failed') NOT NULL,
	`failure_code` varchar(64),
	`content_hash` varchar(64),
	`started_at` timestamp NOT NULL,
	`completed_at` timestamp NOT NULL,
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` varchar(36) NOT NULL,
	`check_id` varchar(36) NOT NULL,
	`monitor_id` varchar(36) NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`byte_size` int NOT NULL,
	`media_type` varchar(128) NOT NULL,
	`confidential` enum('yes','no') NOT NULL DEFAULT 'yes',
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL,
	CONSTRAINT `snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `snapshots_check_id_unique` UNIQUE(`check_id`),
	CONSTRAINT `snapshots_storage_key_unique` UNIQUE(`storage_key`)
);
--> statement-breakpoint
ALTER TABLE `checks` ADD CONSTRAINT `checks_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `snapshots` ADD CONSTRAINT `snapshots_check_id_checks_id_fk` FOREIGN KEY (`check_id`) REFERENCES `checks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `snapshots` ADD CONSTRAINT `snapshots_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `checks_monitor_completed_idx` ON `checks` (`monitor_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `checks_expiry_idx` ON `checks` (`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `snapshots_expiry_idx` ON `snapshots` (`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `snapshots_monitor_created_idx` ON `snapshots` (`monitor_id`,`created_at`);
