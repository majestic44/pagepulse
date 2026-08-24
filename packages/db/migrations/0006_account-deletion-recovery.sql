-- Seven-day account deletion recovery state.
-- Rollback: disable account deletion routes and the maintenance sweep. Restore a verified pre-migration backup if
-- deletion state must be removed; do not drop user columns or narrow the account-token enum in production.
ALTER TABLE `account_tokens` MODIFY COLUMN `type` enum('email_verification','password_reset','account_deletion_recovery') NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_deadline` timestamp;--> statement-breakpoint
CREATE INDEX `users_deletion_deadline_idx` ON `users` (`status`,`deletion_deadline`);
