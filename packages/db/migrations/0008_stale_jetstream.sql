-- Member-selectable monitor schedules. Rollback: disable scheduler reconciliation and restore a
-- verified pre-migration backup if these schedule columns must be removed. Do not drop columns
-- from a live production database without a separately reviewed expand/migrate/contract release.
ALTER TABLE `monitor_schedules` ADD `schedule_type` enum('hourly','daily','custom') DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `monitor_schedules` ADD `time_zone` varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `monitor_schedules` ADD `hourly_minute` int;--> statement-breakpoint
ALTER TABLE `monitor_schedules` ADD `daily_time` varchar(5);--> statement-breakpoint
ALTER TABLE `monitor_schedules` ADD `custom_interval_minutes` int;--> statement-breakpoint
UPDATE `monitor_schedules`
SET `custom_interval_minutes` = GREATEST(60, FLOOR(`interval_ms` / 60000))
WHERE `schedule_type` = 'custom' AND `custom_interval_minutes` IS NULL;
