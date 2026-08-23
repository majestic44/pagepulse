-- Identity and authentication foundation.
-- Rollback: this migration is additive. Disable the auth endpoints and restore a verified pre-migration
-- backup only if the new account state must be removed. Never drop these tables or user columns from a
-- live production database without a separately reviewed contract migration.
CREATE TABLE `account_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` enum('email_verification','password_reset') NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`invited_by_user_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`redeemed_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` varchar(512);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `password_changed_at` timestamp;--> statement-breakpoint
ALTER TABLE `account_tokens` ADD CONSTRAINT `account_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invited_by_user_id_users_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_tokens_user_type_state_idx` ON `account_tokens` (`user_id`,`type`,`used_at`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `invitations_email_state_idx` ON `invitations` (`email`,`redeemed_at`,`revoked_at`);
