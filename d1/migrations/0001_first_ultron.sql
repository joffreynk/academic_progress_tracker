ALTER TABLE `daily_student_records` ADD `punctuality` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `admin_date_override_days` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `admin_can_override_future` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `admin_override_requires_reason` integer DEFAULT true NOT NULL;