-- Owner bootstrap token foundation.
-- Rollback: this table is additive. If a deployment must be rolled back, disable the bootstrap
-- command and restore a verified pre-migration backup only when the pending owner and setup token
-- must be removed. Never drop this table from a live production database without a reviewed contract migration.
CREATE TABLE `owner_setup_tokens` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `owner_setup_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_setup_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `owner_setup_tokens` ADD CONSTRAINT `owner_setup_tokens_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `owner_setup_tokens_owner_state_idx` ON `owner_setup_tokens` (`owner_id`,`used_at`,`revoked_at`,`expires_at`);
