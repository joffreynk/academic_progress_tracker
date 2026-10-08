ALTER TABLE `daily_student_records` RENAME TO `daily_student_records_old`;--> statement-breakpoint
ALTER TABLE `daily_lessons` RENAME TO `monthly_lessons`;--> statement-breakpoint
CREATE TABLE `monthly_student_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`monthly_lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_name_snapshot` text,
	`student_code_snapshot` text,
	`attendance_status` text NOT NULL,
	`performance` text,
	`participation` text,
	`homework` text,
	`conduct` text,
	`comment` text,
	`punctuality` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`monthly_lesson_id`) REFERENCES `monthly_lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `monthly_student_records` (`id`,`organization_id`,`monthly_lesson_id`,`student_id`,`student_name_snapshot`,`student_code_snapshot`,`attendance_status`,`performance`,`participation`,`homework`,`conduct`,`comment`,`punctuality`,`created_at`,`updated_at`)
	SELECT `id`,`organization_id`,`daily_lesson_id`,`student_id`,`student_name_snapshot`,`student_code_snapshot`,`attendance_status`,`performance`,`participation`,`homework`,`conduct`,`comment`,`punctuality`,`created_at`,`updated_at` FROM `daily_student_records_old`;--> statement-breakpoint
DROP TABLE `daily_student_records_old`;--> statement-breakpoint
CREATE UNIQUE INDEX `record_lesson_student` ON `monthly_student_records` (`monthly_lesson_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `records_student_idx` ON `monthly_student_records` (`organization_id`,`student_id`);--> statement-breakpoint
UPDATE `audit_logs` SET `entity_type` = 'monthly_lesson' WHERE `entity_type` = 'daily_lesson';--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `reporting_cadence`;
