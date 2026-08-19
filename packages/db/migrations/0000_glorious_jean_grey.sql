-- Initial PagePulse database foundation.
-- Rollback: restore from a verified pre-migration backup; production migrations do not include destructive down SQL.
CREATE TABLE `monitors` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`state` enum('active','paused','blocked','authentication_required') NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schema_compatibility` (
	`schema_version` int NOT NULL,
	`migration_id` varchar(128) NOT NULL,
	`minimum_app_version` varchar(128) NOT NULL,
	`maximum_app_version` varchar(128),
	`recorded_app_version` varchar(128) NOT NULL,
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `schema_compatibility_schema_version` PRIMARY KEY(`schema_version`),
	CONSTRAINT `schema_compatibility_migration_id_unique` UNIQUE(`migration_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('owner','member') NOT NULL DEFAULT 'member',
	`status` enum('invited','active','suspended','deleting') NOT NULL DEFAULT 'invited',
	`monitor_limit` int NOT NULL DEFAULT 50,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `monitors` ADD CONSTRAINT `monitors_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `monitors_owner_state_idx` ON `monitors` (`owner_id`,`state`);
