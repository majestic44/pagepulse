-- Transactional outbox and scheduler registry foundation.
-- Rollback: the tables are additive. If a deployment must be rolled back, stop the scheduler,
-- restore a verified pre-migration backup only when the new rows must be removed, and never drop
-- these tables from a live production database without a separately reviewed contract migration.
CREATE TABLE `monitor_schedules` (
	`monitor_id` varchar(36) NOT NULL,
	`monitor_revision` int NOT NULL,
	`interval_ms` int NOT NULL,
	`correlation_id` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_schedules_monitor_id` PRIMARY KEY(`monitor_id`)
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` varchar(128) NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`subject_type` varchar(64) NOT NULL,
	`subject_id` varchar(128) NOT NULL,
	`correlation_id` varchar(128) NOT NULL,
	`available_at` timestamp NOT NULL DEFAULT (now()),
	`published_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `monitor_schedules` ADD CONSTRAINT `monitor_schedules_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `monitor_schedules_revision_idx` ON `monitor_schedules` (`monitor_revision`);--> statement-breakpoint
CREATE INDEX `outbox_events_pending_idx` ON `outbox_events` (`published_at`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `outbox_events_subject_idx` ON `outbox_events` (`subject_type`,`subject_id`);
