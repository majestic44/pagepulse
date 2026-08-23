-- Server-side session foundation.
-- Rollback: this migration is additive. Disable session endpoints and restore a verified pre-migration backup if
-- session records must be removed. Never drop this table from a live production database without a separately
-- reviewed contract migration.
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`device_label` varchar(160) NOT NULL,
	`last_used_at` timestamp NOT NULL,
	`idle_expires_at` timestamp NOT NULL,
	`absolute_expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sessions_user_active_idx` ON `sessions` (`user_id`,`revoked_at`,`idle_expires_at`,`absolute_expires_at`,`last_used_at`);
