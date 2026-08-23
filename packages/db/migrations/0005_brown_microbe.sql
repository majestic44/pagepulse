-- Optional TOTP factor and recovery-code foundation.
-- Rollback: this migration is additive. Disable TOTP routes and restore a verified pre-migration backup if these
-- records must be removed. Do not drop factor tables from a live database without a separately reviewed contract migration.
CREATE TABLE `totp_enrollments` (
	`user_id` varchar(36) NOT NULL,
	`secret_ciphertext` varchar(512) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `totp_enrollments_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `totp_login_challenges` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `totp_login_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `totp_login_challenges_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `totp_methods` (
	`user_id` varchar(36) NOT NULL,
	`secret_ciphertext` varchar(512) NOT NULL,
	`last_verified_time_step` bigint,
	`enabled_at` timestamp NOT NULL,
	`updated_at` timestamp NOT NULL,
	CONSTRAINT `totp_methods_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `totp_recovery_codes` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `totp_recovery_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `totp_enrollments` ADD CONSTRAINT `totp_enrollments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `totp_login_challenges` ADD CONSTRAINT `totp_login_challenges_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `totp_methods` ADD CONSTRAINT `totp_methods_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `totp_recovery_codes` ADD CONSTRAINT `totp_recovery_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `totp_login_challenges_user_state_idx` ON `totp_login_challenges` (`user_id`,`used_at`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `totp_recovery_codes_user_state_idx` ON `totp_recovery_codes` (`user_id`,`used_at`);--> statement-breakpoint
CREATE INDEX `totp_recovery_codes_user_hash_idx` ON `totp_recovery_codes` (`user_id`,`code_hash`);
