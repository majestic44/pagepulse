-- Security and administrative audit records with 90-day retention.
-- Rollback: disable audit writes and the owner audit feed, then restore a verified pre-migration backup if the
-- table must be removed. Do not drop audit history in production.
CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`actor_user_id` varchar(36),
	`action` varchar(96) NOT NULL,
	`target_type` varchar(32) NOT NULL,
	`target_id` varchar(128),
	`requester_ip_hash` varchar(64),
	`request_id` varchar(128),
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_events_expiry_idx` ON `audit_events` (`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`target_type`,`target_id`,`created_at`);
